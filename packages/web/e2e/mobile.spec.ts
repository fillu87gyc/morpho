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

// M15.5: 390px 幅で document が 708px に膨張し、ヘッダ折り返しなし・
// タイトル縦積み・キャンバス見切れが起きていた崩れを headless で検出する。
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test('1本指タップでツールが配置される (タッチでもマウスクリックと同じ経路)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
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
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M15.7: 旧 tick レート (×1で16ms/tick, 640ms/日相当のペース) を再現する日長 (3840ms=16ms×TICKS_PER_DAY) に固定し、既存のタイムアウト前提を崩さない。
    localStorage.setItem('morpho.dayMs.v1', '3840');
  });
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

// M15: 縦持ちビューポートで「オンボーディング → デイループ1周 → 図鑑を開く」の
// 一連の流れが通ることを確認する。
test.describe('縦画面レイアウト (M15)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('オンボーディングを完了 → デイループ1周 → ハンバーガーから図鑑を開く', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // M15.7: オンボーディングは実際に表示させたいので morpho.onboarded.v1 は
    // 立てないが、日長は既定の実時間 (2.4分/日) のままだとデイループ待ちが
    // タイムアウトするので短縮する (他の spec と同じ 3840ms = 旧 tick レート相当)。
    await page.addInitScript(() => localStorage.setItem('morpho.dayMs.v1', '3840'));
    await page.goto('/');

    // ① オンボーディング (コンセプトの3ステップ) を最後まで進める。
    await expect(page.locator('#onboarding')).toBeVisible();
    await page.click('#onboarding-next');
    await page.click('#onboarding-next');
    await page.click('#onboarding-next');
    await expect(page.locator('#onboarding')).toBeHidden();

    await waitForReady(page);
    await expectNoHorizontalOverflow(page);

    // キャンバスが「表示サイズとして」十分な大きさを持つ。checksum≠0 (バッキング
    // ストアに描画がある) だけでは、CSS 表示サイズが 0×0 に潰れてプレイヤーには
    // 何も見えない崩れ (fitCanvas の測定前ゼロ化 × コンテンツ由来の行高) を
    // 素通りさせてしまうため、boundingBox で実表示サイズを検査する。
    const canvasBox = await page.locator('#canvas').boundingBox();
    if (!canvasBox) throw new Error('canvas has no bounding box');
    expect(canvasBox.width).toBeGreaterThan(200);
    expect(canvasBox.height).toBeGreaterThan(200);

    // 下部ツールバーが常時見えている (縦画面レイアウト)。
    await expect(page.locator('#mobile-toolbar')).toBeVisible();
    await expect(page.locator('#mobile-toolbar button.tool[data-tool="food"]')).toBeVisible();

    // ② デイループへ切り替えて1日ぶん委ねる。
    await page.click('#day-loop-mode-toggle');
    await expect(page.locator('#day-loop-bar')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.click('#begin-observe');
    await expect(page.locator('#day-result-modal')).toBeVisible({ timeout: 20_000 });
    await page.click('#dr-next');
    await expect(page.locator('#day-result-modal')).toBeHidden();

    // ③ ハンバーガーからドロワーを開き、図鑑カードを見る。
    await expect(page.locator('.panel.right')).toBeHidden();
    await page.click('#menu-toggle');
    await expect(page.locator('.panel.right')).toBeVisible();
    await expect(page.locator('#ency')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.click('#menu-toggle');
    await expect(page.locator('.panel.right')).toBeHidden();

    expect(errors).toEqual([]);
  });
});
