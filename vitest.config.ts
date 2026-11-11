import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    poolOptions: {
      forks: {
        // Let jsdom provide Web Storage. Vitest does not forward this flag from the launcher.
        execArgv: process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
          ? ['--no-experimental-webstorage']
          : [],
      },
    },
    include: [
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
      'tests/unit/**/*.spec.ts',
      'tests/integration/**/*.test.ts',
      'tests/regression/**/*.test.ts',
    ],
    exclude: ['src/__tests__/integration/skill-multi-platform-export-concurrency-postgres.test.ts'],
    // The document transport gate lives on globalThis; reset it between tests.
    setupFiles: ['src/__tests__/fixtures/document-transport-gate-isolation.ts'],
    // Sharp/fontconfig integration tests share native process resources and are
    // timing-flaky under file-level parallelism. Keep the full suite deterministic.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/index.ts'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Match the native server and browser bundle; mixed ESM/CJS Yjs types are unsafe.
      yjs: path.resolve(__dirname, './node_modules/yjs/dist/yjs.cjs'),
    },
  },
});
