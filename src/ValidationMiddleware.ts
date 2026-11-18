/**
 * ValidationMiddleware
 *
 * PHPNomad's `PHPNomad\Rest\Middleware\ValidationMiddleware`. A controller
 * places it in its own middleware list, where it runs the controller's
 * validation sets and refuses the request when any check fails. Placing
 * it after an authentication middleware means validation runs only for a
 * caller that middleware has accepted.
 *
 * ```ts
 * getMiddleware() {
 *   return [this.signature, new ValidationMiddleware(this)];
 * }
 * ```
 *
 * Where this differs from PHPNomad: `process` returns a promise, because
 * a check may.
 */

import type { Request } from '@tsnomad/http';
import type { Middleware } from './Middleware.js';
import type { HasValidations, ValidationFailure } from './Validation.js';
import { ValidationException } from './exceptions.js';
import type { ValidationSet } from './ValidationSet.js';

export class ValidationMiddleware implements Middleware, HasValidations {
  private readonly validations: Readonly<Record<string, ValidationSet>>;

  /**
   * @param provider - A map of parameter names to sets, or an object with
   *   `getValidations()`, such as the controller. A provider's
   *   `getValidations()` is called once, here, as in PHP, and the map it
   *   answers is kept.
   */
  constructor(provider: Readonly<Record<string, ValidationSet>> | HasValidations) {
    // The assertion names the map this class runs, so the class still
    // builds while the compile-only tests loosen the parameter's types.
    this.validations = (ValidationMiddleware.isProvider(provider) ? provider.getValidations() : provider) as Readonly<Record<string, ValidationSet>>;
  }

  /**
   * Runs every set, in the map's key order, awaiting each before the next,
   * and collects all their failures. When there is any failure it throws
   * `ValidationException('Validations failed.', failures)`, which answers
   * 400 with the `VALIDATION_FAILED` body. It resolves with nothing when
   * every check passes.
   *
   * A check that throws rejects `process` with that error, unchanged, and
   * no later set runs. `RestLifecycle` answers that as an unexpected error.
   */
  async process(request: Request): Promise<void> {
    const failures: ValidationFailure[] = [];
    for (const [key, set] of Object.entries(this.validations)) failures.push(...(await set.getValidationFailures(key, request)));
    if (failures.length > 0) throw new ValidationException('Validations failed.', failures);
  }

  /** The map of parameter names to sets it runs. */
  getValidations(): Readonly<Record<string, ValidationSet>> {
    return this.validations;
  }

  /** True for an object with `getValidations()`, such as a controller, and false for a map of sets. */
  private static isProvider(provider: object): provider is HasValidations {
    return typeof (provider as Partial<HasValidations>).getValidations === 'function';
  }
}
