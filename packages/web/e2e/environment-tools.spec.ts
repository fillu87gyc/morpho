// M10: 温度・毒素ツールと「やり直す」(Undo) の e2e。

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

test('毒素をまくと環境バランスの毒素表示が上がり、消すツールで戻せる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  const before = (await page.locator('#e-toxin-n').textContent())?.trim();
  await page.click('[data-tool="toxin"]');
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  await expect.poll(async () => (await page.locator('#e-toxin-n').textContent())?.trim())
    .not.toBe(before);

  expect(errors).toEqual([]);
});

test('石を置き間違えても「やり直す」(Ctrl+Z) で取り消せる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  await page.click('[data-tool="stone"]');
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  const before = await canvasChecksum(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(async () => canvasChecksum(page), { timeout: 5_000 }).not.toBe(before);
  const afterStone = await canvasChecksum(page);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => canvasChecksum(page), { timeout: 5_000 }).not.toBe(afterStone);

  expect(errors).toEqual([]);
});

test('温度ツール (加温/冷却) を使ってもクラッシュせず、ヒート表示で温度レイヤーが見える', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  await page.click('[data-tool="heat"]');
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);

  await page.click('[data-tool="cool"]');
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);

  await page.click('#toggle-heat');
  await expect(page.locator('#toggle-heat')).toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test('水を止める (drain) ツールも適用できる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  await page.click('[data-tool="drain"]');
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const before = await canvasChecksum(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(async () => canvasChecksum(page), { timeout: 5_000 }).not.toBe(before);

  expect(errors).toEqual([]);
});
