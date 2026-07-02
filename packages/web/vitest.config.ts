import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // e2e/ は Playwright 専用 (test:e2e) なので vitest の対象から外す。
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
  }),
);
