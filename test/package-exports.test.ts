/**
 * The public entry point, imported by package name. Runs now.
 */

import { expect, test } from 'vitest';
import * as rest from '@tsnomad/rest';

test('exports the strategy token, the exceptions, ValidationSet, ValidationMiddleware and RestLifecycle', () => {
  expect(Object.keys(rest).sort()).toEqual(['RestException', 'RestLifecycle', 'RestStrategy', 'ValidationException', 'ValidationMiddleware', 'ValidationSet']);
  expect(rest.RestStrategy.name).toBe('RestStrategy');
});

test('the RestStrategy token carries the name the loader resolves', async () => {
  const { REST_STRATEGY_TOKEN } = await import('@tsnomad/loader');
  expect(rest.RestStrategy.name).toBe(REST_STRATEGY_TOKEN);
});

test('RestLifecycle declares its two dependencies for autowiring', async () => {
  const { LoggerStrategy } = await import('@tsnomad/logger');
  const { ResponseFactory } = await import('@tsnomad/http');
  expect(rest.RestLifecycle.inject).toEqual([LoggerStrategy, ResponseFactory]);
});
