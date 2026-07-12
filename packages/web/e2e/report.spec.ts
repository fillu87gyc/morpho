// M18: 探索レポートの e2e。ヘッダの 📈 から開き、数値サマリと画像保存の
// スモークだけを確認する (推移チャートの座標計算自体は chart.test.ts / report.test.ts の
// 純粋関数テストでカバー済み)。

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

test('探索レポートを開くと数値サマリが見え、画像で保存するとアルバムに追加される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await page.click('#report-open');
  await expect(page.locator('#report-modal')).toBeVisible();
  await expect(page.locator('#report-colonies')).toHaveText(/\d+\/\d+/);
  // M32: 図鑑が37枠→42枠に拡張された (原野が STAGE_ORDER に加わった)。
  await expect(page.locator('#report-species')).toHaveText(/\d+\/42/);
  await expect(page.locator('#report-achievements')).toHaveText(/\d+\/12/);

  await expect(page.locator('#album-count')).toHaveText('0');
  await page.click('#report-save');
  await expect.poll(async () => (await page.locator('#album-count').textContent())?.trim(), { timeout: 5_000 }).toBe('1');

  await page.click('#report-close');
  await expect(page.locator('#report-modal')).toBeHidden();

  expect(errors).toEqual([]);
});
