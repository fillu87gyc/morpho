// E2E スモークテスト。sim-worker (Web Worker) + Canvas 描画 (差分再描画を
// 含む) + HUD 更新という、ユニットテストでは踏めない「本物のブラウザで
// つなげたときに壊れていないか」を確認する回帰ガード。
// `pnpm run build` 済みの dist を `vite preview` で配信して検証する
// (playwright.config.ts の webServer)。

import { test, expect, type Page } from '@playwright/test';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function dayText(page: Page): Promise<string> {
  return (await page.locator('#day').textContent())?.trim() ?? '';
}

async function waitForReady(page: Page): Promise<void> {
  // sim-worker から最初のスナップショットが届くまで day は '0' のまま存在するが、
  // canvas に何か描かれるまで (=Worker が起動しメインループが回るまで) 待つ。
  await expect
    .poll(async () => canvasChecksum(page), { timeout: 15_000 })
    .not.toBe(0);
}

// type=range は Playwright の locator.fill() が使えない ("cannot be filled")
// ので、DOM 上で value を設定して input イベントを発火させる。
async function setSpeedSlider(page: Page, value: number): Promise<void> {
  await page.locator('#speed-slider').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
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

test('起動してキャンバスが描画され、コンソールエラーが出ない', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#canvas')).toBeVisible();
  expect(await dayText(page)).toBe('0');
  expect(errors).toEqual([]);
});

test('放っておくと DAY が進み、キャンバスの絵も変わる (sim-worker が回っている)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  const firstChecksum = await canvasChecksum(page);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 }).toBeGreaterThan(0);
  const laterChecksum = await canvasChecksum(page);

  expect(laterChecksum).not.toBe(firstChecksum);
  expect(errors).toEqual([]);
});

test('エサツールを配置すると出来事ログに記録され、拠点総数が増える', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  const before = Number((await page.locator('#w-ct').textContent())?.trim());
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);

  await expect(page.locator('#w-ct')).toHaveText(String(before + 1));
  await expect(page.locator('#log li').first()).toContainText('栄養を撒いた');
  expect(errors).toEqual([]);
});

test('環境ヒート表示をトグルすると全面再描画され、絵が変わる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  const before = await canvasChecksum(page);
  await page.click('#toggle-heat');
  // トグル直後のフレームで全面フォールバック再描画が起きる。
  await expect.poll(async () => canvasChecksum(page), { timeout: 5_000 }).not.toBe(before);
  await expect(page.locator('#toggle-heat')).toHaveClass(/active/);

  const heated = await canvasChecksum(page);
  await page.click('#toggle-heat');
  await expect.poll(async () => canvasChecksum(page), { timeout: 5_000 }).not.toBe(heated);
  await expect(page.locator('#toggle-heat')).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test('一時停止すると DAY が止まり、再生すると再び進む', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  // 進行を確認しやすいよう速度を上げてから停止する。
  await setSpeedSlider(page, 20);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 }).toBeGreaterThan(0);

  await page.click('#pause-toggle');
  await expect(page.locator('#pause-toggle')).toHaveClass(/active/);
  const pausedDay = await dayText(page);
  await page.waitForTimeout(1500);
  expect(await dayText(page)).toBe(pausedDay);

  await page.click('#pause-toggle');
  await expect(page.locator('#pause-toggle')).not.toHaveClass(/active/);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 })
    .toBeGreaterThan(Number(pausedDay));

  expect(errors).toEqual([]);
});

test('新しい皿へでリセットすると DAY が0、拠点総数が6に戻る', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  await setSpeedSlider(page, 20);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 }).toBeGreaterThan(0);

  // 一時停止してからリセットする — 動かしたままだと reset() 後も
  // sim-worker が高速に tick を進め続け、アサーションが読む前に
  // DAY が 0 を通り過ぎてしまう競合が起きる。
  await page.click('#pause-toggle');
  await expect(page.locator('#pause-toggle')).toHaveClass(/active/);

  await page.click('#reset');
  await expect(page.locator('#day')).toHaveText('0');
  await expect(page.locator('#w-ct')).toHaveText('6');
  await expect(page.locator('#w-cr')).toHaveText('0');

  expect(errors).toEqual([]);
});

test('ホイールでズームしてもクラッシュせず、全体を見るボタンで復帰できる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');
  await waitForReady(page);

  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -1500);
  await page.waitForTimeout(300);

  const zoomedChecksum = await canvasChecksum(page);
  await page.click('#reset-view');
  await page.waitForTimeout(300);
  const resetChecksum = await canvasChecksum(page);

  expect(zoomedChecksum).not.toBe(resetChecksum);
  expect(errors).toEqual([]);
});
