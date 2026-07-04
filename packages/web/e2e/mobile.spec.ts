// モバイル UI (M7) の E2E。1本指タップでのツール配置と、2本指ピンチでの
// ズーム操作を、CDP の Input.dispatchTouchEvent で「本物のタッチ」として
// 発火させて検証する (JS からの合成 PointerEvent 直接 dispatch だと
// canvas.setPointerCapture がブラウザに実タッチと認識されず失敗するため)。

import { test, expect, type Page } from '@playwright/test';

test.use({ hasTouch: true });

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

test('1本指タップでツールが配置される (タッチでもマウスクリックと同じ経路)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  const before = Number((await page.locator('#w-ct').textContent())?.trim());
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.touchscreen.tap(box.x + box.width * 0.3, box.y + box.height * 0.3);

  await expect(page.locator('#w-ct')).toHaveText(String(before + 1));
  expect(errors).toEqual([]);
});

test('2本指ピンチでズームでき、ツールは誤配置されない', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  const before = Number((await page.locator('#w-ct').textContent())?.trim());
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const initialChecksum = await canvasChecksum(page);

  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: cx - 20, y: cy, id: 0 },
      { x: cx + 20, y: cy, id: 1 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      { x: cx - 90, y: cy, id: 0 },
      { x: cx + 90, y: cy, id: 1 },
    ],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect.poll(async () => canvasChecksum(page), { timeout: 5_000 }).not.toBe(initialChecksum);
  // ピンチ中は指の移動があってもツールは適用されない (拠点総数が変わらない)。
  await expect(page.locator('#w-ct')).toHaveText(String(before));

  expect(errors).toEqual([]);
});
