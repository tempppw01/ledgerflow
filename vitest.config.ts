import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    css: true,
    testTimeout: 15000,
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['server/**', '.playwright-cli/**', 'node_modules/**']
  }
});
