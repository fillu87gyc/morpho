import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@morpho/sim': resolve(__dirname, '../sim/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    fs: {
      // sim パッケージのソースを直接読むので、プロジェクト外アクセスを許可。
      allow: [resolve(__dirname, '..')],
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
