/**
 * RestLifecycle
 *
 * Runs one request through a controller, so every platform's REST
 * strategy runs the same stages in the same order and answers errors the
 * same way. A strategy adapts the platform's request to `Request`, calls
 * `handle`, and hands the platform `response.getResponse()` or the
 * response's status, headers and body.
 *
 * Where this differs from PHPNomad: PHPNomad has no such class. Each
 * integration's `RestStrategy` runs the stages itself, and the WordPress
 * one carries a note asking for this logic to be pulled out for reuse.
 * The order and the error answers below are that strategy's. Two more
 * differences: it logs an unexpected error with a message and the
 * endpoint, where PHPNomad logs the bare exception, and it logs a
 * `RestException` with a 5xx code, which PHPNomad answers without a log.
 *
 * Validation is not a stage of its own. As in PHPNomad, a controller
 * places a `ValidationMiddleware` in its middleware list, after any
 * middleware that checks who is calling.
 *
 * Interceptors run after the controller has done its work, and the first
 * one that throws ends the run with an error answer, as in PHPNomad. Work
 * that must happen whenever the controller's change happens, such as an
 * event other systems depend on, belongs in the controller or in a task
 * it dispatches, not in an interceptor.
 */

import type { Request, Response } from '@tsnomad/http';
import { ResponseFactory } from '@tsnomad/http';
import { LoggerStrategy } from '@tsnomad/logger';
import type { Controller } from './Controller.js';
import type { HasInterceptors, HasMiddleware } from './Middleware.js';
import { RestException } from './exceptions.js';

/** PHPNomad's answer to an unexpected error. */
const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred. Sorry, that is all I know.';

export class RestLifecycle {
  static readonly inject = [LoggerStrategy, ResponseFactory] as const;

  constructor(
    private readonly logger: LoggerStrategy,
    private readonly responses: ResponseFactory,
  ) {}

  /**
   * Stages, in order. Each one is awaited before the next starts, and the
   * first that throws ends the run.
   *
   * 1. Middleware, when the controller has `getMiddleware`, in list order.
   * 2. `controller.getResponse(request)`.
   * 3. Interceptors, when the controller has `getInterceptors`, called with
   *    the request and the controller's response, in list order.
   *
   * It answers the controller's response when every stage succeeds. It
   * never calls the controller's `getValidations`. A controller whose
   * `getMiddleware` or `getInterceptors` is there but is not a function,
   * such as a list put where the method belongs, runs no stage and is
   * answered as an unexpected error below, since skipping its middleware
   * would skip the check of who is calling. A method that returns anything
   * but an array, such as `undefined` from a forgotten return or an
   * iterator a reused controller has already spent, is answered the same
   * way when its stage comes, and the stages after it do not run.
   *
   * When a stage throws a `RestException`, including the
   * `ValidationException` from a `ValidationMiddleware`, it answers a new response from
   * `ResponseFactory` with the exception's code as the status and the JSON
   * body `{ error: { message, context } }`. A code from 400 to 499 logs
   * nothing, because the refusal is the designed answer. A code from 500
   * to 599 is a server failure, so it is also logged once, the same way as
   * the unexpected error below.
   *
   * When a stage throws anything else, it logs it once with
   * `logException(error, 'REST request failed', { endpoint, method })`, with
   * no level argument, so the logger's default applies, and answers a new
   * response with status 500 and the JSON body `{ error: { message: 'An unexpected error occurred. Sorry,
   * that is all I know.' } }`, which is PHPNomad's text. The thrown value
   * never reaches the client.
   *
   * When the logger itself throws while it reports an error, it writes one
   * line through Node's `console.error`, `console.error('REST request
   * failed, and the logger threw while reporting it', { endpoint, method,
   * error, loggerError })`, and still answers as above, so neither error
   * is lost and the client still gets its answer.
   *
   * It rejects only when `ResponseFactory` throws while it answers an
   * error, with that error.
   */
  async handle(controller: Controller, request: Request): Promise<Response> {
    const stages = controller as Controller & Partial<HasMiddleware & HasInterceptors>;
    try {
      // Checked before any stage runs, so a broken interceptor member cannot
      // let the controller's change happen first. A broken middleware member
      // fails when it is called, which is also before any stage. A method
      // that returns anything but an array fails, so a forgotten return or
      // a spent iterator cannot skip a stage.
      RestLifecycle.checkStage(stages, 'getInterceptors');
      const middlewareList = stages.getMiddleware === undefined ? [] : RestLifecycle.list(stages.getMiddleware(request), 'getMiddleware');
      for (const middleware of middlewareList) await middleware.process(request);
      const response = await controller.getResponse(request);
      const interceptorList = stages.getInterceptors === undefined ? [] : RestLifecycle.list(stages.getInterceptors(request, response), 'getInterceptors');
      for (const interceptor of interceptorList) await interceptor.process(request, response);
      return response;
    } catch (error) {
      if (error instanceof RestException) {
        // A 4xx code is a designed refusal, such as a failed signature or
        // validation, so it is answered without a log. A 5xx code is a
        // server failure and is logged like an unexpected error.
        if (error.getCode() >= 500) this.report(error, controller);
        return this.responses
          .create()
          .setStatus(error.getCode())
          .setJson({ error: { message: error.message, context: error.getContext() } });
      }
      this.report(error, controller);
      return this.responses.create().setStatus(500).setJson({ error: { message: UNEXPECTED_ERROR_MESSAGE } });
    }
  }

  /**
   * Passes when the controller has nothing under the stage's name, or a
   * function.
   *
   * @throws TypeError when the name holds anything else
   */
  private static checkStage(controller: object, name: 'getInterceptors'): void {
    const member: unknown = (controller as Record<string, unknown>)[name];
    if (member !== undefined && typeof member !== 'function') {
      throw new TypeError(`RestLifecycle: the controller's ${name} is not a function`);
    }
  }

  /**
   * Passes an array through.
   *
   * @throws TypeError for anything else, an iterable included
   */
  private static list<T>(value: readonly T[], name: 'getMiddleware' | 'getInterceptors'): readonly T[] {
    if (!Array.isArray(value)) throw new TypeError(`RestLifecycle: the controller's ${name} did not return an array`);
    return value;
  }

  /** Logs a failed request once, and falls back to console.error when the logger throws. */
  private report(error: unknown, controller: Controller): void {
    const where = { endpoint: controller.getEndpoint(), method: controller.getMethod() };
    try {
      this.logger.logException(error, 'REST request failed', where);
    } catch (loggerError) {
      console.error('REST request failed, and the logger threw while reporting it', { ...where, error, loggerError });
    }
  }
}
