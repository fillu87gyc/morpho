// M13: 系統樹の分岐 (1つの親から複数回採種し、任意の祖先から再開する) の e2e。

import { test, expect, type Page } from './fixtures.js';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function canvasChecksum(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 97) sum += data[i] ?? 0;
    return sum;
  });
}

async function waitForReady(page: Page): Promise<void> {
  await expect.poll(async () => canvasChecksum(page), { timeout: 15_000 }).not.toBe(0);
}

// M16: 4段速度ボタン (旧スライダーの置き換え)。既存 e2e は「×24 にする」
// 用途でしか使っていなかったため、専用ヘルパーへ簡略化する。
async function setSpeedMax(page: Page): Promise<void> {
  await page.click('#speed-btn-24');
}

test('1つの親から2匹の子を育てると系統樹が枝分かれして表示される', async ({ page }) => {
  // M16.5: Day>=5 の待ちを3回繰り返す構成上、並列実行時の CPU 競合に
  // 弱い (このサンドボックスでも 2 worker 並列だと 20〜26s かかることがある)。
  // 既定の 30s では機能自体は正しいのにタイムアウトしうるため緩める。
  test.setTimeout(60_000);
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  await setSpeedMax(page);
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(5);
  await page.click('#harvest-seed'); // 1代目を採取 → 2代目としてプレイ中

  // 2代目からもう1匹採る (=同じ1代目を親に持つ2匹目の子ができる)
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(5);
  await page.click('#harvest-seed');

  // 1代目のノードで「この子から始める」を押すと、そこから新しい3代目が始まる
  const genOneNode = page.locator('.lineage-node', { hasText: '1代目' }).first();
  await genOneNode.locator('.lineage-start-btn').click();
  await expect(page.locator('#lineage-gen')).toHaveText('現在 2代目');

  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(5);
  await page.click('#harvest-seed');

  // 1代目の下に2代目が2つ (枝分かれ) 並ぶ
  await expect(page.locator('.lineage-node', { hasText: '2代目' })).toHaveCount(2);

  expect(errors).toEqual([]);
});

test('M18: 採種すると系統樹ノードにサムネイルが付く (IndexedDB への非同期保存)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await setSpeedMax(page);
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(5);
  await page.click('#harvest-seed');

  // renderThumbnail → toBlob → fetch → IndexedDB 保存は複数ホップの非同期
  // 処理で、harvest() 自体 (同期) より確実に遅れて完了する。
  await expect.poll(async () => page.locator('#lineage .lineage-thumb').count(), { timeout: 10_000 }).toBe(1);
  const src = await page.locator('#lineage .lineage-thumb').first().getAttribute('src');
  expect(src).toMatch(/^blob:/);

  expect(errors).toEqual([]);
});
