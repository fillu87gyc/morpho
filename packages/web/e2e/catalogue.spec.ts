// M13: 図鑑グリッド (37枠、M14で大陸ステージが加わり32→37、M32で原野が加わり37→42)
// と実績バッジグリッドの e2e。

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

test('図鑑は42枠のグリッドで始まり、Day3を超えると1枠発見してサムネイルとカウントが更新される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
  await page.goto('/');
  await waitForReady(page);

  // M32: 原野が STAGE_ORDER に加わり、5タイプ×7ステージ+特殊7種 = 42枠になった
  // (以前は 5×6+7=37枠)。
  await expect(page.locator('#ency-progress')).toHaveText('0/42');
  await expect(page.locator('.ency-slot')).toHaveCount(42);
  await expect(page.locator('.ency-slot.discovered')).toHaveCount(0);

  await setSpeedMax(page);
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(3);

  await expect.poll(async () => page.locator('.ency-slot.discovered').count(), { timeout: 10_000 }).toBeGreaterThan(0);
  await expect(page.locator('#ency-progress')).not.toHaveText('0/42');
  await expect.poll(
    async () => page.locator('.ency-slot.discovered .ency-thumb img').count(),
    { timeout: 10_000 },
  ).toBeGreaterThan(0);

  // クリックでお気に入りに切り替わる
  const firstDiscovered = page.locator('.ency-slot.discovered').first();
  await firstDiscovered.click();
  await expect(firstDiscovered).toHaveClass(/favorite/);

  expect(errors).toEqual([]);
});

test('実績はバッジグリッドで12個表示され、達成すると解除アイコンに変わる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長
    // (3840ms=16ms×TICKS_PER_DAY) だと、並列実行でCPUが混み合い waitForReady()
    // までに実時間が余分にかかった場合、初期6分岐 (皿3コロニー×初期分岐) の
    // radius が育って 'pillar' (太い幹20本以上) の閾値をこの待ち時間だけで
    // 越えてしまうことがある (実測: 2ワーカー並列だと再現性あり)。
    // 「開始時点で0個」の検査自体はこの後まだ何も操作していないことの確認が
    // 目的なので、待ち時間中に自然発生する tick 数を絞るため日長をさらに
    // 長くする (この後の実績解除の検査は setSpeedMax で ×24 にするので
    // 影響しない)。
    localStorage.setItem('morpho.dayMs.v1', '40000');
  });
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#ach-progress')).toHaveText('0/12');
  await expect(page.locator('.ach-badge')).toHaveCount(12);
  await expect(page.locator('.ach-badge.unlocked')).toHaveCount(0);

  await page.click('[data-tool="food"]');
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(box.x + box.width * (0.2 + i * 0.1), box.y + box.height * 0.5);
  }
  await setSpeedMax(page);
  await expect.poll(async () => page.locator('.ach-badge.unlocked').count(), { timeout: 20_000 }).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
