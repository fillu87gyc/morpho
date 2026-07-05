// M12: 個体の同定 (名前・★・特性チップ) と追跡カメラの e2e。

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

test('個体ビューに名前・★評価・特性チップが表示され、タップで改名できる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#ind-name')).toHaveText('ねばりのこ #1');
  await expect(page.locator('#ind-stars')).toHaveText(/^[★☆]{5}$/);
  await expect(page.locator('#ind-chips .chip')).not.toHaveCount(0);

  page.once('dialog', (dialog) => dialog.accept('つよいこ'));
  await page.click('#ind-name');
  await expect(page.locator('#ind-name')).toHaveText('つよいこ');

  expect(errors).toEqual([]);
});

test('新しい皿へ を押すと個体番号が進む', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#ind-name')).toHaveText('ねばりのこ #1');
  await page.click('#reset');
  await expect(page.locator('#ind-name')).toHaveText('ねばりのこ #2');

  expect(errors).toEqual([]);
});

test('個体を追跡するとカメラが動き、手動ズームで追従が解除される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await page.click('#track-toggle');
  await expect(page.locator('#track-toggle')).toHaveClass(/active/);

  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(200);
  await expect(page.locator('#track-toggle')).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});
