// M11: 通貨HUDとゆるいデイリーの e2e。

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

test('エサを配置するとしずくが減り、ゆるいデイリーとチャレンジが3件ずつ表示される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('.dailies li')).toHaveCount(3);
  await expect(page.locator('#chal-list li')).toHaveCount(3);
  await expect(page.locator('#chal-progress')).toHaveText('0/3');

  const before = Number((await page.locator('#cur-sizuku').textContent())?.trim());
  await page.click('[data-tool="food"]');
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);

  await expect.poll(async () => Number((await page.locator('#cur-sizuku').textContent())?.trim()))
    .toBeLessThan(before);

  expect(errors).toEqual([]);
});
