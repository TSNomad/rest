/**
 * Middleware, Interceptor, and the interfaces a controller implements to
 * name them
 *
 * PHPNomad's `Middleware`, `Interceptor`, `HasMiddleware` and
 * `HasInterceptors`. Middleware runs before the controller and may refuse
 * the request by throwing a `RestException`. An interceptor runs after the
 * controller with its response, for work such as broadcasting an event or
 * adding a header.
 *
 * Where this differs from PHPNomad: `process` may return a promise, and
 * `RestLifecycle` waits for it.
 */

import type { Request, Response } from '@tsnomad/http';

export interface Middleware {
  /** @throws RestException to refuse the request */
  process(request: Request): void | Promise<void>;
}

export interface Interceptor {
  process(request: Request, response: Response): void | Promise<void>;
}

export interface HasMiddleware {
  getMiddleware(request: Request): readonly Middleware[];
}

export interface HasInterceptors {
  getInterceptors(request: Request, response: Response): readonly Interceptor[];
}
