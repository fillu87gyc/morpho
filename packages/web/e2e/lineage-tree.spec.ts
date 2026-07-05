// M13: 系統樹の分岐 (1つの親から複数回採種し、任意の祖先から再開する) の e2e。

import { test, expect, type Page } from '@playwright/test';

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

async function setSpeedSlider(page: Page, value: number): Promise<void> {
  await page.locator('#speed-slider').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('1つの親から2匹の子を育てると系統樹が枝分かれして表示される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  await setSpeedSlider(page, 24);
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
