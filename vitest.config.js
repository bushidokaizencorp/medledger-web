import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    fileParallelism: false, // one shared SQLite test DB
    hookTimeout: 30000,
  },
});
