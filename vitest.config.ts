import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
  test: {
    globals: true,
    // Exclude pre-existing editor-engine tests (they use bun:test, not vitest).
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/scripts/__tests__/**',
      '**/e2e/**',
      '**/editor-engine/vendor/editor/**/__tests__/**',
    ],
  },
});
