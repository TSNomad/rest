import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'rest',
    setupFiles: ['./test/network-guard.ts'],
  },
});
