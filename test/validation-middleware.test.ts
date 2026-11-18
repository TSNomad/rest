/**
 * Acceptance tests for ValidationMiddleware. They run real ValidationSets
 * and expect a real ValidationException, and the last two run the
 * middleware inside RestLifecycle, behind an authentication step.
 */

import { describe, expect, test } from 'vitest';
import { Method } from '@tsnomad/http';
import type { Request, Response } from '@tsnomad/http';
import { RestException, RestLifecycle, ValidationException, ValidationMiddleware, ValidationSet } from '@tsnomad/rest';
import type { Controller, HasMiddleware, HasValidations, Middleware, Validation } from '@tsnomad/rest';
import { FakeRequest, FakeResponse, FakeResponseFactory, RecordingLogger, tick } from './fakes.js';

class Always implements Validation {
  constructor(private readonly ok: boolean, private readonly type = 'CHECK', private readonly log?: string[]) {}
  async isValid(key: string) {
    this.log?.push(`${key} start`);
    await tick();
    this.log?.push(`${key} end`);
    return this.ok;
  }
  getErrorMessage(key: string) { return `${key} is bad`; }
  getContext() { return { why: this.type }; }
  getType() { return this.type; }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('ValidationMiddleware', () => {
  test("runs every set and throws one ValidationException with all their failures, PHPNomad's message and code 400", async () => {
    const middleware = new ValidationMiddleware({
      email: new ValidationSet().setRequired(),
      qty: new ValidationSet().addValidation(() => new Always(false, 'NUMERIC')),
      note: new ValidationSet().addValidation(() => new Always(true)),
    });

    const error = await rejection(middleware.process(new FakeRequest({ qty: 'x', note: 'n' })));

    expect(error).toBeInstanceOf(ValidationException);
    const thrown = error as ValidationException;
    expect(thrown.message).toBe('Validations failed.');
    expect(thrown.getCode()).toBe(400);
    expect(thrown.getContext()).toEqual({
      type: 'VALIDATION_FAILED',
      failedValidations: [
        { field: 'email', message: 'email is required.', type: 'REQUIRED' },
        { field: 'qty', message: 'qty is bad', type: 'NUMERIC', context: { why: 'NUMERIC' } },
      ],
    });
  });

  test('resolves with nothing when every check passes', async () => {
    const middleware = new ValidationMiddleware({
      qty: new ValidationSet().setRequired().addValidation(() => new Always(true)),
    });

    await expect(middleware.process(new FakeRequest({ qty: 1 }))).resolves.toBeUndefined();
  });

  test('runs the sets in key order, awaiting each before the next starts', async () => {
    const log: string[] = [];
    const middleware = new ValidationMiddleware({
      b: new ValidationSet().addValidation(() => new Always(false, 'B', log)),
      a: new ValidationSet().addValidation(() => new Always(false, 'A', log)),
    });

    const error = (await rejection(middleware.process(new FakeRequest({ a: 1, b: 2 })))) as ValidationException;

    expect(log).toEqual(['b start', 'b end', 'a start', 'a end']);
    expect((error.getContext().failedValidations as { field: string }[]).map((f) => f.field)).toEqual(['b', 'a']);
  });

  test("takes a provider with getValidations, such as the controller, and reads it once, at construction", async () => {
    const sets = { id: new ValidationSet().setRequired() };
    let reads = 0;
    const provider: HasValidations = {
      getValidations() {
        reads++;
        return sets;
      },
    };

    const middleware = new ValidationMiddleware(provider);
    expect(reads).toBe(1);
    await rejection(middleware.process(new FakeRequest()));
    await rejection(middleware.process(new FakeRequest()));

    expect(reads).toBe(1);
    expect(middleware.getValidations()).toEqual(sets);
    expect(middleware.getValidations().id).toBe(sets.id);
  });

  test('takes a map of sets directly, and answers it from getValidations', () => {
    const sets = { id: new ValidationSet(), name: new ValidationSet() };

    const middleware = new ValidationMiddleware(sets);

    expect(Object.keys(middleware.getValidations())).toEqual(['id', 'name']);
    expect(middleware.getValidations().name).toBe(sets.name);
  });

  test('a check that throws rejects process with that error, unchanged, and no later set runs', async () => {
    const boom = new Error('check failed');
    const log: string[] = [];
    const middleware = new ValidationMiddleware({
      a: new ValidationSet().addValidation(() => ({ isValid() { throw boom; }, getErrorMessage: () => '', getContext: () => ({}), getType: () => 'X' })),
      b: new ValidationSet().addValidation(() => new Always(false, 'B', log)),
    });

    expect(await rejection(middleware.process(new FakeRequest({ a: 1, b: 2 })))).toBe(boom);
    expect(log).toEqual([]);
  });
});

describe('ValidationMiddleware inside RestLifecycle', () => {
  /** A controller that places an auth step before its ValidationMiddleware, as PHPNomad controllers do. */
  class CreateOrder implements Controller, HasMiddleware, HasValidations {
    readonly log: string[] = [];
    readonly own = new FakeResponse('controller');
    constructor(private readonly auth: Middleware, private readonly sets: Record<string, ValidationSet>) {}
    getEndpoint() { return '/orders'; }
    getMethod() { return Method.Post; }
    getValidations() { return this.sets; }
    getMiddleware(): Middleware[] { return [this.auth, new ValidationMiddleware(this)]; }
    async getResponse(_request: Request): Promise<Response> {
      this.log.push('controller');
      return this.own;
    }
  }

  function lifecycle() {
    const logger = new RecordingLogger();
    const responses = new FakeResponseFactory();
    return { logger, responses, runner: new RestLifecycle(logger, responses) };
  }

  test("runs after the middleware placed before it, and its failures answer 400 with the VALIDATION_FAILED body, unlogged", async () => {
    const { runner, logger, responses } = lifecycle();
    const order: string[] = [];
    const auth: Middleware = { async process() { order.push('auth'); } };
    const controller = new CreateOrder(auth, {
      qty: new ValidationSet().addValidation(() => {
        order.push('validation');
        return new Always(false, 'NUMERIC');
      }),
    });

    const response = await runner.handle(controller, new FakeRequest({ qty: 'x' }));

    expect(order).toEqual(['auth', 'validation']);
    expect(controller.log).toEqual([]);
    expect(response).toBe(responses.created[0]);
    expect(response.getStatus()).toBe(400);
    expect(response.getJson()).toEqual({
      error: {
        message: 'Validations failed.',
        context: {
          type: 'VALIDATION_FAILED',
          failedValidations: [{ field: 'qty', message: 'qty is bad', type: 'NUMERIC', context: { why: 'NUMERIC' } }],
        },
      },
    });
    expect(logger.calls).toEqual([]);

    const refused = new CreateOrder({ async process() { throw new RestException('Unauthorized', {}, 401); } }, {
      qty: new ValidationSet().addValidation(() => {
        order.push('validation again');
        return new Always(false);
      }),
    });
    expect((await runner.handle(refused, new FakeRequest({ qty: 'x' }))).getStatus()).toBe(401);
    expect(order).not.toContain('validation again');
  });

  test('an error from a check is unexpected: logged once and answered 500, and the controller never runs', async () => {
    const { runner, logger } = lifecycle();
    const boom = new Error('check failed');
    const controller = new CreateOrder({ async process() {} }, {
      a: new ValidationSet().addValidation(() => ({ isValid() { throw boom; }, getErrorMessage: () => '', getContext: () => ({}), getType: () => 'X' })),
    });

    const response = await runner.handle(controller, new FakeRequest({ a: 1 }));

    expect(response.getStatus()).toBe(500);
    expect(controller.log).toEqual([]);
    expect(logger.calls.map((c) => c.args[0])).toEqual([boom]);
  });
});
