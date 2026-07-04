import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// サンドボックス環境ではプリインストール済み Chromium (このパッケージが
// 要求するバージョンと食い違うことがある) を明示的に指させる。
// 存在しなければ (通常の CI 等) undefined のままデフォルト解決に任せる。
const sandboxChromium = '/opt/pw-browsers/chromium';
const executablePath = existsSync(sandboxChromium) ? sandboxChromium : undefined;

// CI では時間がかかっても良いのでリトライを多めに、ローカルでは素早く。
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // dist は CI/ローカルどちらでも事前に `pnpm run build` 済みの前提。
    // --host を明示しないと 'localhost' の名前解決結果 (IPv6 の ::1 など)
    // にバインドされることがあり、127.0.0.1 への疎通を待つ webServer.url
    // がいつまでも繋がらずタイムアウトする (GitHub Actions の ubuntu-latest
    // ランナーで実際に発生した)。IPv4 ループバックへ明示的にバインドする。
    command: 'pnpm exec vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
    },
  ],
});
