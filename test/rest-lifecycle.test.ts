/**
 * Acceptance tests for RestLifecycle. ValidationMiddleware's tests also
 * run it, behind an authentication step.
 */

import { describe, expect, test, vi } from 'vitest';
import { Container } from '@tsnomad/di-container';
import { Method, ResponseFactory } from '@tsnomad/http';
import type { Request, Response } from '@tsnomad/http';
import { LoggerStrategy } from '@tsnomad/logger';
import { RestException, RestLifecycle } from '@tsnomad/rest';
import type { Controller, Interceptor, Middleware } from '@tsnomad/rest';
import { FakeRequest, FakeResponse, FakeResponseFactory, RecordingLogger, tick } from './fakes.js';

const UNEXPECTED = 'An unexpected error occurred. Sorry, that is all I know.';

function lifecycle() {
  const logger = new RecordingLogger();
  const responses = new FakeResponseFactory();
  return { logger, responses, runner: new RestLifecycle(logger, responses) };
}

/** A controller that logs each stage it is asked for, and each stage's run. */
function staged(log: string[], options: {
  middleware?: Middleware[];
  interceptors?: Interceptor[];
  respond?: (request: Request) => Promise<Response>;
} = {}): Controller & Record<string, unknown> {
  const own = new FakeResponse('controller');
  const controller: Controller & Record<string, unknown> = {
    getEndpoint: () => '/orders/{id}',
    getMethod: () => Method.Post,
    async getResponse(request: Request) {
      log.push('controller start');
      await tick();
      log.push('controller end');
      return options.respond ? options.respond(request) : own;
    },
    own,
  };
  if (options.middleware) controller.getMiddleware = (request: Request) => (log.push('getMiddleware'), controller.middlewareRequest = request, options.middleware);
  if (options.interceptors) controller.getInterceptors = (request: Request, response: Response) => (log.push('getInterceptors'), controller.interceptorArgs = [request, response], options.interceptors);
  return controller;
}

function step(log: string[], name: string, fail?: unknown): Middleware & Interceptor {
  return {
    async process() {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
      if (fail !== undefined) throw fail;
    },
  };
}

describe('RestLifecycle.handle', () => {
  test('runs middleware in order, then the controller, then interceptors in order, awaiting each', async () => {
    const { runner, logger } = lifecycle();
    const log: string[] = [];
    const controller = staged(log, {
      middleware: [step(log, 'm1'), step(log, 'm2')],
      interceptors: [step(log, 'i1'), step(log, 'i2')],
    });

    const response = await runner.handle(controller, new FakeRequest({ id: 7 }));

    expect(log).toEqual([
      'getMiddleware', 'm1 start', 'm1 end', 'm2 start', 'm2 end',
      'controller start', 'controller end',
      'getInterceptors', 'i1 start', 'i1 end', 'i2 start', 'i2 end',
    ]);
    expect(response).toBe(controller.own);
    expect(logger.calls).toEqual([]);
  });

  test("answers the controller's own response, and hands getMiddleware the request and getInterceptors the request and that response", async () => {
    const { runner, responses } = lifecycle();
    const log: string[] = [];
    const request = new FakeRequest({});
    const controller = staged(log, { middleware: [], interceptors: [] });

    const response = await runner.handle(controller, request);

    expect(response).toBe(controller.own);
    expect(controller.middlewareRequest).toBe(request);
    expect(controller.interceptorArgs).toEqual([request, controller.own]);
    expect((controller.interceptorArgs as unknown[])[1]).toBe(controller.own);
    expect(responses.created).toEqual([]);
  });

  test('runs only getResponse for a controller with no middleware or interceptors', async () => {
    const { runner } = lifecycle();
    const log: string[] = [];
    const controller = staged(log);

    expect(await runner.handle(controller, new FakeRequest())).toBe(controller.own);
    expect(log).toEqual(['controller start', 'controller end']);
  });

  test("never calls a controller's getValidations, which a ValidationMiddleware in its middleware reads", async () => {
    const { runner } = lifecycle();
    const log: string[] = [];
    const controller = staged(log, { middleware: [step(log, 'm1')] });
    controller.getValidations = () => {
      log.push('getValidations');
      return {};
    };

    expect(await runner.handle(controller, new FakeRequest())).toBe(controller.own);
    expect(log).toEqual(['getMiddleware', 'm1 start', 'm1 end', 'controller start', 'controller end']);
  });

  test("a middleware's RestException stops the run and answers its code with { error: { message, context } }, unlogged", async () => {
    const { runner, logger, responses } = lifecycle();
    const log: string[] = [];
    const controller = staged(log, {
      middleware: [step(log, 'm1', new RestException('Signature mismatch', { header: 'x-signature' }, 401)), step(log, 'm2')],
      interceptors: [step(log, 'i1')],
    });

    const response = await runner.handle(controller, new FakeRequest());

    expect(log).toEqual(['getMiddleware', 'm1 start', 'm1 end']);
    expect(response).toBe(responses.created[0]);
    expect(response.getStatus()).toBe(401);
    expect(response.getJson()).toEqual({ error: { message: 'Signature mismatch', context: { header: 'x-signature' } } });
    expect(logger.calls).toEqual([]);
  });

  test("a controller's RestException answers its code, unlogged", async () => {
    const { runner, logger } = lifecycle();
    const log: string[] = [];
    const controller = staged(log, {
      respond: async () => {
        throw new RestException('Order not found', { id: '7' }, 404);
      },
      interceptors: [step(log, 'i1')],
    });

    const response = await runner.handle(controller, new FakeRequest());

    expect(response.getStatus()).toBe(404);
    expect(response.getJson()).toEqual({ error: { message: 'Order not found', context: { id: '7' } } });
    expect(log).toEqual(['controller start', 'controller end']);
    expect(logger.calls).toEqual([]);
  });

  test('a RestException with a 5xx code answers its code and body, and is logged once', async () => {
    const { runner, logger } = lifecycle();
    const log: string[] = [];
    const upstream = new RestException('Upstream unavailable', { service: 'catalog' }, 500);
    const controller = staged(log, {
      respond: async () => {
        throw upstream;
      },
    });

    const response = await runner.handle(controller, new FakeRequest());

    expect(response.getStatus()).toBe(500);
    expect(response.getJson()).toEqual({ error: { message: 'Upstream unavailable', context: { service: 'catalog' } } });
    expect(logger.calls).toEqual([
      { method: 'logException', args: [upstream, 'REST request failed', { endpoint: '/orders/{id}', method: 'POST' }, undefined] },
    ]);
  });

  test("an interceptor's RestException replaces the controller's response and stops later interceptors", async () => {
    const { runner, responses } = lifecycle();
    const log: string[] = [];
    const controller = staged(log, {
      interceptors: [step(log, 'i1', new RestException('Too late', {}, 409)), step(log, 'i2')],
    });

    const response = await runner.handle(controller, new FakeRequest());

    expect(response).not.toBe(controller.own);
    expect(response).toBe(responses.created[0]);
    expect(response.getStatus()).toBe(409);
    expect(response.getJson()).toEqual({ error: { message: 'Too late', context: {} } });
    expect(log).toEqual(['controller start', 'controller end', 'getInterceptors', 'i1 start', 'i1 end']);
  });

  test("any other error is logged once and answered as a 500 with PHPNomad's text, never its own message", async () => {
    const { runner, logger, responses } = lifecycle();
    const log: string[] = [];
    const boom = new Error('connection string postgres://user:secret@db');
    const controller = staged(log, {
      respond: async () => {
        throw boom;
      },
      interceptors: [step(log, 'i1')],
    });

    const response = await runner.handle(controller, new FakeRequest());

    expect(response).toBe(responses.created[0]);
    expect(response.getStatus()).toBe(500);
    expect(response.getJson()).toEqual({ error: { message: UNEXPECTED } });
    expect(response.getBody()).not.toContain('secret');
    expect(log).toEqual(['controller start', 'controller end']);
    expect(logger.calls).toEqual([
      { method: 'logException', args: [boom, 'REST request failed', { endpoint: '/orders/{id}', method: 'POST' }, undefined] },
    ]);
    expect(logger.calls[0].args[0]).toBe(boom);
  });

  test('runs no stage and answers a 500 when getMiddleware or getInterceptors is there but is not a function', async () => {
    for (const name of ['getMiddleware', 'getInterceptors'] as const) {
      // A list where the method belongs, or null. Skipping either would skip the check of who is calling.
      for (const member of [[step([], 'auth', new RestException('Unauthorized', {}, 401))], null]) {
        const label = `${name} ${member === null ? 'null' : 'list'}`;
        const { runner, logger } = lifecycle();
        const log: string[] = [];
        const controller = staged(log);
        controller[name] = member;

        const response = await runner.handle(controller, new FakeRequest());

        expect(response.getStatus(), label).toBe(500);
        expect(response.getJson(), label).toEqual({ error: { message: UNEXPECTED } });
        expect(log, label).toEqual([]);
        expect(logger.calls.map((c) => c.method), label).toEqual(['logException']);
        expect(logger.calls[0].args[0], label).toBeInstanceOf(TypeError);
      }
    }
  });

  test('answers a 500 and runs no later stage when getMiddleware or getInterceptors returns anything but an array', async () => {
    // A forgotten return in the method that adds the check of who is calling,
    // or an iterator a controller the container reuses has already spent.
    const spent = [step([], 'auth', new RestException('Unauthorized', {}, 401))].values();
    Array.from(spent);
    for (const value of [undefined, null, spent]) {
      const before = lifecycle();
      const beforeLog: string[] = [];
      const guarded = staged(beforeLog);
      guarded.getMiddleware = () => (beforeLog.push('getMiddleware'), value);

      const refused = await before.runner.handle(guarded, new FakeRequest());

      expect(refused.getStatus(), String(value)).toBe(500);
      expect(refused.getJson(), String(value)).toEqual({ error: { message: UNEXPECTED } });
      expect(beforeLog, String(value)).toEqual(['getMiddleware']);
      expect(before.logger.calls.map((c) => c.method), String(value)).toEqual(['logException']);
      expect(before.logger.calls[0].args[0], String(value)).toBeInstanceOf(TypeError);

      const after = lifecycle();
      const afterLog: string[] = [];
      const intercepted = staged(afterLog);
      intercepted.getInterceptors = () => (afterLog.push('getInterceptors'), value);

      const failed = await after.runner.handle(intercepted, new FakeRequest());

      expect(failed.getStatus(), String(value)).toBe(500);
      expect(failed.getJson(), String(value)).toEqual({ error: { message: UNEXPECTED } });
      expect(afterLog, String(value)).toEqual(['controller start', 'controller end', 'getInterceptors']);
      expect(after.logger.calls.map((c) => c.method), String(value)).toEqual(['logException']);
      expect(after.logger.calls[0].args[0], String(value)).toBeInstanceOf(TypeError);
    }
  });

  test('treats a thrown value that is not an Error the same way, from any stage', async () => {
    for (const stage of ['middleware', 'interceptor'] as const) {
      const { runner, logger } = lifecycle();
      const log: string[] = [];
      const failing = step(log, 'x', 'a plain string');
      const controller = staged(log, stage === 'middleware' ? { middleware: [failing] } : { interceptors: [failing] });

      const response = await runner.handle(controller, new FakeRequest());

      expect(response.getStatus(), stage).toBe(500);
      expect(response.getJson(), stage).toEqual({ error: { message: UNEXPECTED } });
      expect(logger.calls.map((c) => [c.method, c.args[0]]), stage).toEqual([['logException', 'a plain string']]);
    }
  });

  test('writes both errors to console.error and still answers when the logger throws while reporting', async () => {
    const { runner, logger, responses } = lifecycle();
    const loggerError = new Error('log sink down');
    logger.logException = () => {
      throw loggerError;
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boom = new Error('db down');
      const unexpected = await runner.handle(staged([], { respond: async () => { throw boom; } }), new FakeRequest());
      const upstream = new RestException('Upstream unavailable', {}, 503);
      const refused = await runner.handle(staged([], { respond: async () => { throw upstream; } }), new FakeRequest());

      expect(unexpected).toBe(responses.created[0]);
      expect(unexpected.getStatus()).toBe(500);
      expect(unexpected.getJson()).toEqual({ error: { message: UNEXPECTED } });
      expect(refused.getStatus()).toBe(503);
      expect(errors.mock.calls).toEqual([
        ['REST request failed, and the logger threw while reporting it', { endpoint: '/orders/{id}', method: 'POST', error: boom, loggerError }],
        ['REST request failed, and the logger threw while reporting it', { endpoint: '/orders/{id}', method: 'POST', error: upstream, loggerError }],
      ]);
    } finally {
      errors.mockRestore();
    }
  });

  test("rejects with the factory's own error when ResponseFactory throws while it answers an error", async () => {
    const logger = new RecordingLogger();
    const broken = new Error('factory down');
    const responses: ResponseFactory = {
      create() {
        throw broken;
      },
    };
    const runner = new RestLifecycle(logger, responses);
    const boom = new Error('db down');

    const error = await runner.handle(staged([], { respond: async () => { throw boom; } }), new FakeRequest()).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBe(broken);
    expect(logger.calls.map((c) => c.args[0])).toEqual([boom]);
  });

  test('autowires from a container with LoggerStrategy and ResponseFactory bound', async () => {
    const container = new Container();
    const logger = new RecordingLogger();
    const responses = new FakeResponseFactory();
    container.bindFactory(LoggerStrategy, () => logger);
    container.bindFactory(ResponseFactory, () => responses);

    const runner = await container.get(RestLifecycle);
    const controller = staged([], {
      respond: async () => {
        throw new Error('x');
      },
    });
    const response = await runner.handle(controller, new FakeRequest());

    expect(response).toBe(responses.created[0]);
    expect(response.getStatus()).toBe(500);
    expect(logger.calls).toHaveLength(1);
  });
});
