/**
 * ValidationSet
 *
 * PHPNomad's `PHPNomad\Rest\Factories\ValidationSet`: the checks for one
 * request parameter, and whether the parameter is required.
 *
 * ```ts
 * getValidations() {
 *   return {
 *     email: new ValidationSet().setRequired().addValidation(() => new IsEmail()),
 *   };
 * }
 * ```
 */

import type { Request } from '@tsnomad/http';
import type { Validation, ValidationFailure } from './Validation.js';

export class ValidationSet {
  /** The getters, in the order they were added. */
  private readonly getters: Array<() => Validation> = [];
  /** Each check built so far, by the index of its getter. */
  private readonly built = new Map<number, Validation>();
  private required = false;

  /**
   * Adds a check. The getter runs at most once per set, the first time the
   * check is needed, as PHPNomad's instance cache does.
   */
  addValidation(getter: () => Validation): this {
    this.getters.push(getter);
    return this;
  }

  /** Marks the parameter required, or not. */
  setRequired(isRequired: boolean = true): this {
    this.required = isRequired;
    return this;
  }

  /**
   * The failures for parameter `key`, in PHPNomad's order:
   *
   * 1. When the set is not required and the request has no such
   *    parameter, none, and no check runs.
   * 2. When it is required and the parameter is absent, one failure
   *    `{ field: key, message: '<key> is required.', type: 'REQUIRED' }`.
   *    The checks still run after it, as in PHP.
   * 3. One failure per check whose `isValid` answers anything but true,
   *    in the order the checks were added: `{ field: key, message:
   *    getErrorMessage(key, request), type: getType(), context:
   *    getContext() }`. Each check is awaited before the next starts.
   *
   * A check that throws rejects the call with that error, unchanged.
   */
  async getValidationFailures(key: string, request: Request): Promise<ValidationFailure[]> {
    const failures: ValidationFailure[] = [];
    const present = request.hasParam(key);
    if (!this.required && !present) return failures;
    if (this.required && !present) failures.push({ field: key, message: `${key} is required.`, type: 'REQUIRED' });
    for (let i = 0; i < this.getters.length; i++) {
      const validation = this.validationAt(i);
      if ((await validation.isValid(key, request)) !== true) {
        failures.push({ field: key, message: validation.getErrorMessage(key, request), type: validation.getType(), context: validation.getContext() });
      }
    }
    return failures;
  }

  /** The check from getter `i`, built on first use and kept for this set's life. */
  private validationAt(i: number): Validation {
    let validation = this.built.get(i);
    if (validation === undefined) {
      validation = this.getters[i]();
      this.built.set(i, validation);
    }
    return validation;
  }
}
