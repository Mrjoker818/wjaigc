import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/__tests__/**/*.test.ts',
      'tests/unit/**/*.spec.ts',
      'tests/integration/**/*.test.ts',
    ],
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
    },
  },
});
