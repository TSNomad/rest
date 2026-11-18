/**
 * Acceptance tests for ValidationSet.
 */

import { describe, expect, test } from 'vitest';
import { ValidationSet } from '@tsnomad/rest';
import type { Validation } from '@tsnomad/rest';
import type { Request } from '@tsnomad/http';
import { FakeRequest, tick } from './fakes.js';

class Check implements Validation {
  calls = 0;
  constructor(
    private readonly answer: (key: string, request: Request) => unknown,
    readonly type = 'CHECK',
    readonly context: Record<string, unknown> = { limit: 3 },
  ) {}
  isValid(key: string, request: Request): boolean {
    this.calls++;
    return this.answer(key, request) as boolean;
  }
  getErrorMessage(key: string, request: Request) {
    return `${key} failed ${this.type} with ${String(request.getParam(key))}`;
  }
  getContext() { return this.context; }
  getType() { return this.type; }
}

describe('ValidationSet', () => {
  test('finds nothing and runs no check when an optional parameter is absent', async () => {
    let built = 0;
    const set = new ValidationSet().addValidation(() => {
      built++;
      return new Check(() => false);
    });

    expect(await set.getValidationFailures('email', new FakeRequest({}))).toEqual([]);
    expect(built).toBe(0);
  });

  test('reports a missing required parameter first, then still runs the checks, as PHP does', async () => {
    const check = new Check(() => false, 'EMAIL', {});
    const set = new ValidationSet().setRequired().addValidation(() => check);

    expect(await set.getValidationFailures('email', new FakeRequest({ other: 1 }))).toEqual([
      { field: 'email', message: 'email is required.', type: 'REQUIRED' },
      { field: 'email', message: 'email failed EMAIL with null', type: 'EMAIL', context: {} },
    ]);
    expect(check.calls).toBe(1);
  });

  test('reports one failure per failing check, in the order they were added, and none for a passing one', async () => {
    const set = new ValidationSet()
      .addValidation(() => new Check(() => false, 'FIRST', { n: 1 }))
      .addValidation(() => new Check(() => true, 'PASSES'))
      .addValidation(() => new Check(() => false, 'THIRD', { n: 3 }));

    expect(await set.getValidationFailures('qty', new FakeRequest({ qty: 'x' }))).toEqual([
      { field: 'qty', message: 'qty failed FIRST with x', type: 'FIRST', context: { n: 1 } },
      { field: 'qty', message: 'qty failed THIRD with x', type: 'THIRD', context: { n: 3 } },
    ]);
  });

  test('passes the key and the request to each check', async () => {
    const seen: Array<[string, Request]> = [];
    const request = new FakeRequest({ qty: 2 });
    const set = new ValidationSet().addValidation(() => new Check((key, req) => (seen.push([key, req]), true)));

    expect(await set.getValidationFailures('qty', request)).toEqual([]);
    expect(seen).toEqual([['qty', request]]);
    expect(seen[0][1]).toBe(request);
  });

  test('treats any answer but true as a failure, so a check that forgets to answer fails closed', async () => {
    for (const answer of [undefined, null, 'yes', 1, {}]) {
      const set = new ValidationSet().addValidation(() => new Check(() => answer));
      const failures = await set.getValidationFailures('qty', new FakeRequest({ qty: 1 }));
      expect(failures, String(answer)).toHaveLength(1);
    }
  });

  test('awaits a check that answers a promise, one check at a time', async () => {
    const log: string[] = [];
    const slow = (name: string, answer: boolean): Validation => ({
      async isValid() {
        log.push(`${name} start`);
        await tick();
        log.push(`${name} end`);
        return answer;
      },
      getErrorMessage: () => `${name} failed`,
      getContext: () => ({}),
      getType: () => name,
    });
    const set = new ValidationSet().addValidation(() => slow('a', false)).addValidation(() => slow('b', true));

    const failures = await set.getValidationFailures('qty', new FakeRequest({ qty: 1 }));
    expect(failures.map((f) => f.type)).toEqual(['a']);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end']);
  });

  test('builds each check once per set, however often it runs', async () => {
    let built = 0;
    const set = new ValidationSet().addValidation(() => {
      built++;
      return new Check(() => true);
    });
    await set.getValidationFailures('a', new FakeRequest({ a: 1 }));
    await set.getValidationFailures('a', new FakeRequest({ a: 2 }));

    expect(built).toBe(1);
  });

  test('rejects with the error a check throws, unchanged', async () => {
    const boom = new Error('lookup failed');
    const set = new ValidationSet().addValidation(() => new Check(() => {
      throw boom;
    }));

    await expect(set.getValidationFailures('a', new FakeRequest({ a: 1 }))).rejects.toBe(boom);
  });

  test('setRequired takes false, defaults to true, and the setters return the set', async () => {
    const set = new ValidationSet();
    expect(set.setRequired()).toBe(set);
    expect(set.setRequired(false)).toBe(set);
    expect(set.addValidation(() => new Check(() => true))).toBe(set);
    expect(await set.getValidationFailures('a', new FakeRequest({}))).toEqual([]);

    const required = new ValidationSet().setRequired(false).setRequired();
    expect(await required.getValidationFailures('a', new FakeRequest({}))).toEqual([{ field: 'a', message: 'a is required.', type: 'REQUIRED' }]);
  });

  test('a parameter present with the value null counts as present', async () => {
    const set = new ValidationSet().setRequired();
    expect(await set.getValidationFailures('a', new FakeRequest({ a: null }))).toEqual([]);
  });
});
