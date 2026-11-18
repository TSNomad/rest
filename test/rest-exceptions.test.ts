/**
 * Acceptance tests for RestException and ValidationException.
 */

import { describe, expect, test } from 'vitest';
import { RestException, ValidationException } from '@tsnomad/rest';
import type { ValidationFailure } from '@tsnomad/rest';

describe('RestException', () => {
  test('carries its message, its context, the default code 400 and its name', () => {
    const error = new RestException('Store not connected', { reason: 'no_grant' });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Store not connected');
    expect(error.getContext()).toEqual({ reason: 'no_grant' });
    expect(error.getCode()).toBe(400);
    expect(error.name).toBe('RestException');
  });

  test('takes any error status from 400 to 599 as its code, and an empty context by default', () => {
    expect(new RestException('Not found', {}, 404).getCode()).toBe(404);
    expect(new RestException('Down', {}, 503).getCode()).toBe(503);
    expect(new RestException('Edge', {}, 599).getCode()).toBe(599);
    expect(new RestException('No context').getContext()).toEqual({});
  });

  test('refuses a code that is not a whole number from 400 to 599', () => {
    for (const code of [399, 600, 200, 302, 400.5, Number.NaN, -400]) {
      expect(() => new RestException('m', {}, code), String(code)).toThrow(RangeError);
    }
    expect(() => new RestException('m', {}, '404' as never)).toThrow(RangeError);
  });

  test("keeps its own copy of the context, so neither the caller's object nor the getter's answer changes it", () => {
    const context: Record<string, unknown> = { a: 1 };
    const error = new RestException('m', context);
    context.a = 2;
    error.getContext().a = 3;

    expect(error.getContext()).toEqual({ a: 1 });
  });
});

describe('ValidationException', () => {
  const failures: ValidationFailure[] = [
    { field: 'email', message: 'email is required.', type: 'REQUIRED' },
    { field: 'email', message: 'email must be an email address', type: 'EMAIL', context: {} },
  ];

  test("is a RestException whose context is PHPNomad's VALIDATION_FAILED shape", () => {
    const error = new ValidationException('Validations failed.', failures);

    expect(error).toBeInstanceOf(RestException);
    expect(error.name).toBe('ValidationException');
    expect(error.message).toBe('Validations failed.');
    expect(error.getCode()).toBe(400);
    expect(error.getContext()).toEqual({ type: 'VALIDATION_FAILED', failedValidations: failures });
  });

  test('takes another error status', () => {
    expect(new ValidationException('Validations failed.', failures, 422).getCode()).toBe(422);
    expect(() => new ValidationException('Validations failed.', failures, 200)).toThrow(RangeError);
  });
});
