/**
 * Controller and HasControllers
 *
 * PHPNomad's `PHPNomad\Rest\Interfaces\Controller` and `HasControllers`.
 * A controller names its endpoint and method and builds the response for
 * one request. The loader reads `getControllers()` from an initializer and
 * hands the REST strategy a getter for each controller class, which the
 * strategy calls when it needs the controller.
 *
 * An endpoint uses `{name}` for a path parameter, as PHPNomad's does, such
 * as `/connect/webhooks/{id}`. The strategy converts it to the platform's
 * own form.
 *
 * Where this differs from PHPNomad: `getResponse` returns a promise.
 */

import type { Method, Request, Response } from '@tsnomad/http';

export interface Controller {
  getEndpoint(): string;
  getMethod(): Method;
  getResponse(request: Request): Promise<Response>;
}

/** A class whose instances are controllers. */
export type ControllerClass<C extends Controller = Controller> = abstract new (...args: any[]) => C;

export interface HasControllers {
  getControllers(): readonly ControllerClass[];
}
