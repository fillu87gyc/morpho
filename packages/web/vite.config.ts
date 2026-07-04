import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages はリポジトリ名のサブパス (https://<user>.github.io/<repo>/) に
// 配置される。ローカル開発・プレビューはルート ('/') のままで、
// pages.yml が `VITE_BASE=/<repo>/` を渡してビルドするときだけ変わる。
const BASE = process.env.VITE_BASE || '/';

export default defineConfig({
  base: BASE,
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
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  plugins: [
    VitePWA({
      // sim-worker.ts (Web Worker) を含む全アセットは自前で addEventListener
      // せずに Workbox の生成 SW (generateSW) に任せる。手動更新 UI は
      // 持たないので registerType は自動更新にする。
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        id: BASE,
        name: 'モルフォ — 委ねて、育ついのち',
        short_name: 'モルフォ',
        description: '粘菌を育てる、委ねて観察するWebゲーム',
        lang: 'ja',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0d0c',
        theme_color: '#0b0d0c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // モルフォは1画面 SPA。オフライン起動できるよう全ビルド成果物を
        // プリキャッシュし、ナビゲーションは常に index.html にフォールバックする。
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: `${BASE}index.html`,
      },
      devOptions: {
        // dev サーバでも SW を有効にして手元で挙動確認できるようにする。
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
