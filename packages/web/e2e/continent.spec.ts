// M14: 大陸ステージの e2e。拠点が20を超えて生成され、専用クエストが
// 表示され、通常どおり進行することを確認する。

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

test('大陸ステージへ切り替えると拠点が20を超え、専用クエストが表示されて進行する', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await page.selectOption('#stage-select', 'continent');
  await expect(page.locator('#stage-name')).toHaveText('大陸');
  await expect(page.locator('#day')).toHaveText('0');

  // 拠点総数 (w-ct) が皿の6よりずっと多い (source 6 + 食料拠点 20〜30 個相当)。
  await expect.poll(async () => Number((await page.locator('#w-ct').textContent())?.trim()))
    .toBeGreaterThan(20);

  // 大陸専用クエストのカードが見える。
  await expect(page.locator('#q-continent-item')).toBeVisible();

  await setSpeedSlider(page, 24);
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  // 他ステージへ戻すと大陸専用クエストは再び隠れる。
  await page.selectOption('#stage-select', 'petri');
  await expect(page.locator('#q-continent-item')).toBeHidden();
  await expect(page.locator('#w-ct')).toHaveText('6');

  expect(errors).toEqual([]);
});
