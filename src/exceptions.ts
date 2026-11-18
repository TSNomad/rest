/**
 * REST exceptions
 *
 * PHPNomad's `RestException` and `ValidationException`. Middleware, a
 * validation or a controller throws one to answer the request with an
 * error. `RestLifecycle` turns it into a response with the code as the
 * status and a body of `{ error: { message, context } }`.
 */

import type { ValidationFailure } from './Validation.js';

export class RestException extends Error {
  private readonly code: number;
  private readonly context: Record<string, unknown>;

  /**
   * @param message - The message the client sees
   * @param context - Detail the client sees with it
   * @param code - The HTTP status, 400 by default
   * @throws RangeError when `code` is not a whole number from 400 to 599.
   *   PHP takes any integer. A code outside that range is not an error
   *   status, and a response must not answer it as one.
   */
  constructor(message: string, context: Record<string, unknown> = {}, code: number = 400) {
    if (!(Number.isInteger(code) && code >= 400 && code <= 599)) {
      throw new RangeError(`RestException code must be a whole number from 400 to 599, got ${String(code)}.`);
    }
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = { ...context };
  }

  /** The HTTP status. */
  getCode(): number {
    return this.code;
  }

  /** A copy of the context. */
  getContext(): Record<string, unknown> {
    return { ...this.context };
  }
}

export class ValidationException extends RestException {
  /**
   * The context is `{ type: 'VALIDATION_FAILED', failedValidations: failures }`,
   * as in PHP.
   *
   * @param message - The message, such as 'Validations failed.'
   * @param failures - Every failed check
   * @param code - The HTTP status, 400 by default
   */
  constructor(message: string, failures: readonly ValidationFailure[], code: number = 400) {
    super(message, { type: 'VALIDATION_FAILED', failedValidations: failures }, code);
  }
}
