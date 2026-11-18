/**
 * RestStrategy
 *
 * PHPNomad's `PHPNomad\Rest\Interfaces\RestStrategy`: registers one route
 * per controller with the platform. The strategy calls the getter when it
 * needs the controller, as PHPNomad's
 * `registerRoute(fn() => $container->get($controller))`, and hands each
 * request to `RestLifecycle`.
 *
 * Where this differs from PHPNomad: the getter answers a promise, because
 * the container's `get` is async, and `registerRoute` may return a
 * promise, which the loader waits for. Its token carries the name
 * 'RestStrategy', which is the string @tsnomad/loader resolves.
 */

import { createToken } from '@tsnomad/di-container';
import type { Controller } from './Controller.js';

export interface RestStrategy {
  registerRoute(getController: () => Promise<Controller>): void | Promise<void>;
}

export const RestStrategy = createToken<RestStrategy>('RestStrategy');
