// M15.7: 全 e2e スペック共通の test/expect。「1日」の実時間長は本番向けに
// 2.4分/日 (×1、time-scale.ts の DEFAULT_DAY_MS) へ伸ばしたが、既存 e2e の
// 大半は「数秒待てば日が進む」ことを前提にしている。addInitScript で
// localStorage に短縮オーバーライド (time-scale.ts が読む
// `morpho.dayMs.v1`) を積む。個別のスペックが別の値 (例: 旧 tick レート
// 相当の 3840ms/日) を検証したい場合は、テスト側で同じキーに
// addInitScript すれば後勝ちで上書きできる。
import { test as base, expect, type Page } from '@playwright/test';

// ×1 で 1日 = 0.5秒 (本番の 144秒よりずっと短い)。既存 e2e のタイムアウト
// (15〜20秒) の中で余裕を持って日をまたげる値。
export const E2E_DAY_MS = 500;

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript((ms) => {
      window.localStorage.setItem('morpho.dayMs.v1', String(ms));
    }, E2E_DAY_MS);
    await use(page);
  },
});

export { expect, type Page };
