import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': workspaceRoot,
      '@editor': resolve(workspaceRoot, 'editor-engine/vendor/editor'),
    },
  },
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
