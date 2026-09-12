import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/__tests__/integration/skill-run-approval-postgres.test.ts',
      'src/__tests__/integration/brief-to-video-concurrency-postgres.test.ts',
    ],
    fileParallelism: false,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
