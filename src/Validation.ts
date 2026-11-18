/**
 * Validation and HasValidations
 *
 * PHPNomad's `Validation` and `HasValidations`. A validation checks one
 * request parameter, named by `key`. A controller that implements
 * `HasValidations` maps each parameter to a `ValidationSet`, and passes
 * itself to a `ValidationMiddleware` in its middleware list, which runs
 * them.
 *
 * Where this differs from PHPNomad: `isValid` may return a promise, for a
 * check that reads a store.
 */

import type { Request } from '@tsnomad/http';
import type { ValidationSet } from './ValidationSet.js';

export interface Validation {
  isValid(key: string, request: Request): boolean | Promise<boolean>;
  getErrorMessage(key: string, request: Request): string;
  /** Extra detail for the failure, such as the limit a value broke. */
  getContext(): Record<string, unknown>;
  /** A short code for the kind of failure, such as 'TYPE' or 'EMAIL'. */
  getType(): string;
}

export interface HasValidations {
  getValidations(): Readonly<Record<string, ValidationSet>>;
}

/**
 * One failed check, in PHPNomad's shape. A missing required parameter has
 * the type 'REQUIRED' and no context.
 */
export interface ValidationFailure {
  field: string;
  message: string;
  type: string;
  context?: Record<string, unknown>;
}
