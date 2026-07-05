// M16.5: 絵作りのビジュアルリグレッション。
//
// 実際のピクセル比較 (toHaveScreenshot) は避けた — CI は
// `playwright install --with-deps chromium` で毎回フレッシュな Chromium を
// 落とすのに対し、このサンドボックスは `/opt/pw-browsers/chromium` を
// 使う (playwright.config.ts 参照)。ビルドが違えばフォント/GPU ラスタライズ
// が微妙にずれてベースライン PNG が容易にフレーキーになるため、
// 「実際に見える絵」を getImageData の統計 (地形の明るさ) で検査する
// 方式にした。
//
// 検査対象は「画面隅 (まだ生物が届いていない領域) の明るさ」。旧配色は
// STAGE_BG がほぼ黒 (#0b0d0c 付近、輝度実測 ≈ 7.5) だったのに対し、地形の
// 露出底上げ後は苔の地肌が下地になり輝度が大きく上がる (実測 ≈ 49)。
// 拠点/岩/水などランダム配置の地形特徴が隅に来ても、旧配色のような暗さへ
// 戻ることはない (石・水・毒素のどれも旧 STAGE_BG よりずっと明るい) ため、
// seed が固定できなくても安定して検査できる。
import { test, expect, type Page } from '@playwright/test';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function waitForReady(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 97) sum += data[i] ?? 0;
    return sum;
  }), { timeout: 15_000 }).not.toBe(0);
}

// 画面左上隅 (まだ生物が届いていないことが多い領域) の平均輝度 [0,255]。
async function cornerLuma(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0, sampled = 0;
    const x1 = Math.floor(width * 0.14);
    const y1 = Math.floor(height * 0.14);
    for (let y = 0; y < y1; y += 2) {
      for (let x = 0; x < x1; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
        sum += 0.299 * r + 0.587 * g + 0.114 * b;
        sampled++;
      }
    }
    return sum / Math.max(1, sampled);
  });
}

test('皿ステージの地形が「ほぼ黒」に退行していない (M16.5 絵作りの回帰ガード)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  // 実測: 旧配色 (STAGE_BG ≈ rgb(14,20,17)) は隅の輝度 ≈ 7.5、
  // 底上げ後の新配色 (STAGE_BG petri inner ≈ rgb(88,104,64) + 苔の粒ノイズ)
  // は隅の輝度 ≈ 49。しきい値はその中間よりだいぶ低い側に置き、
  // seed 差による地形特徴の揺れを吸収しつつ「ほぼ黒」への退行だけを検出する。
  expect(await cornerLuma(page)).toBeGreaterThan(20);

  expect(errors).toEqual([]);
});
