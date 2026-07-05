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
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
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
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#ind-name')).toHaveText('ねばりのこ #1');
  await page.click('#reset');
  await expect(page.locator('#ind-name')).toHaveText('ねばりのこ #2');

  expect(errors).toEqual([]);
});

test('M17: ズームインして注視ON → 視野外の出来事が消え、OFFに戻すと再び見える', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);
  // sim イベント (太い幹が育った 等) の連続発生でログが埋まり、この後置く
  // エサの出来事が30件の上限から押し出されてしまうのを避けるため一時停止する
  // (e2e の短縮日長では特に流れが速い)。
  await page.click('#speed-btn-pause');

  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');

  // ① ズームアウトした状態 (世界全体が見える) で1箇所にエサを置く。
  // クリック → Worker 往復 → 次フレームの DOM 反映は非同期なので、直後の
  // 同期カウントは遅い CI ランナーで 0 のまま読めてしまう (flake)。④⑤と
  // 同じく poll で出現を待ってからカウントを取る。
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.15);
  await expect
    .poll(async () => page.locator('#log li', { hasText: '栄養を撒いた' }).count())
    .toBeGreaterThan(0);
  const totalBefore = await page.locator('#log li', { hasText: '栄養を撒いた' }).count();

  // ② 反対側の隅を中心に大きくズームインする — ①の座標は新しい視野の外に出る。
  const farCorner = { x: box.x + box.width * 0.85, y: box.y + box.height * 0.85 };
  await page.mouse.move(farCorner.x, farCorner.y);
  await page.mouse.wheel(0, -3000);
  await page.waitForTimeout(200);

  // ③ ズームインした (今の視野内の) 位置にもう1箇所エサを置く。①と同じく
  // 非同期反映を poll で待つ。
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect
    .poll(async () => page.locator('#log li', { hasText: '栄養を撒いた' }).count())
    .toBeGreaterThan(totalBefore);
  const totalAfter = await page.locator('#log li', { hasText: '栄養を撒いた' }).count();

  // ④ 「このエリアを注視中」をONにすると、視野外 (①) の出来事が消えて表示件数が減る。
  await page.click('#log-area-toggle');
  await expect(page.locator('#log-area-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#log-area-label')).toBeVisible();
  await expect
    .poll(async () => page.locator('#log li', { hasText: '栄養を撒いた' }).count())
    .toBeLessThan(totalAfter);

  // ⑤ OFFに戻すと全件が再び見える。
  await page.click('#log-area-toggle');
  await expect(page.locator('#log-area-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(async () => page.locator('#log li', { hasText: '栄養を撒いた' }).count())
    .toBe(totalAfter);

  expect(errors).toEqual([]);
});

test('個体を追跡するとカメラが動き、手動ズームで追従が解除される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
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
