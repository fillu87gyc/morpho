// M15.7: 全 e2e スペック共通の test/expect。「1日」の実時間長は本番向けに
// 2分/日 (×1) へ伸ばした (sim-worker.ts) が、既存 e2e の大半は「数秒待てば
// 日が進む」ことを前提にしている。addInitScript で localStorage に
// 短縮オーバーライドを積み、main.ts 経由で Worker に伝える (Worker はページの
// localStorage を直接読めない)。個別のスペックが本番ペースを検証したい場合は
// このモジュールを使わず @playwright/test から直接 import すればよい。
import { test as base, expect, type Page } from '@playwright/test';

// ×1 で 1日 = 0.5秒 (本番の 120秒よりずっと短い)。既存 e2e のタイムアウト
// (15〜20秒) の中で余裕を持って日をまたげる値。
export const E2E_DAY_MS = 500;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((ms) => {
      window.localStorage.setItem('morpho.e2eDayMs.v1', String(ms));
    }, E2E_DAY_MS);
    await use(page);
  },
});

export { expect, type Page };
