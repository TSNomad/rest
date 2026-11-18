/**
 * Compile-only checks, run by `npm run typecheck`. Each @ts-expect-error
 * line must stay an error. Nothing here runs.
 *
 * The first block pins what the loader's ports file asks of this package:
 * the REST types stay assignable to the shapes @tsnomad/loader reads.
 */

import type { HasControllers as LoaderHasControllers, LoaderRestStrategy, ControllerClass as LoaderControllerClass } from '@tsnomad/loader';
import { Method } from '@tsnomad/http';
import type { Request, Response } from '@tsnomad/http';
import { ValidationMiddleware, ValidationSet } from '@tsnomad/rest';
import type { Controller, ControllerClass, HasControllers, HasInterceptors, HasMiddleware, HasValidations, Middleware, RestStrategy } from '@tsnomad/rest';

declare const strategy: RestStrategy;
declare const controllers: HasControllers;
declare const controllerClass: ControllerClass;

const asLoaderStrategy: LoaderRestStrategy = strategy;
const asLoaderControllers: LoaderHasControllers = controllers;
const asLoaderClass: LoaderControllerClass = controllerClass;

declare const response: Response;

class GetOrder implements Controller, HasMiddleware, HasInterceptors, HasValidations {
  getEndpoint() { return '/orders/{id}'; }
  getMethod() { return Method.Get; }
  async getResponse(request: Request) { return response; }
  getMiddleware(request: Request): Middleware[] { return []; }
  getInterceptors(request: Request, reply: Response) { return []; }
  getValidations() { return { id: new ValidationSet().setRequired() }; }
}

const listed: HasControllers = { getControllers: () => [GetOrder] };

// @ts-expect-error getResponse answers a promise
const syncController: Controller = { getEndpoint: () => '/', getMethod: () => Method.Get, getResponse: (request: Request) => response };

// @ts-expect-error a method outside the six
const badMethod: Controller = { getEndpoint: () => '/', getMethod: () => 'TRACE', getResponse: async () => response };

// @ts-expect-error getControllers lists classes, not instances
const instances: HasControllers = { getControllers: () => [new GetOrder()] };

// @ts-expect-error a validation map holds ValidationSets
const badValidations: HasValidations = { getValidations: () => ({ id: true }) };

// @ts-expect-error ValidationMiddleware takes ValidationSets or a provider of them
const badMiddleware = new ValidationMiddleware({ id: true });

// @ts-expect-error the getter answers a promise of a controller
strategy.registerRoute(() => new GetOrder());

void [asLoaderStrategy, asLoaderControllers, asLoaderClass, listed, syncController, badMethod, instances, badValidations, badMiddleware];
