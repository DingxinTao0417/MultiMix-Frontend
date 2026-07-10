import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Exclude pre-existing editor-engine tests (they use bun:test, not vitest).
    exclude: [
      '**/node_modules/**',
      'scripts/__tests__/**',
      '**/editor-engine/vendor/editor/**/__tests__/**',
    ],
  },
});
