import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.ts',
      'dashboard/src/**/__tests__/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'dashboard/src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'dashboard/src/**/__tests__/**'],
    },
  },
  resolve: {
    // Allow .js extension imports to resolve .ts files (tsx / vitest pattern).
    // '@' alias resolves to dashboard/src — mirrors dashboard/tsconfig.json paths.
    extensions: ['.ts', '.js'],
    alias: {
      '@': resolve(__dirname, 'dashboard/src'),
    },
  },
});
