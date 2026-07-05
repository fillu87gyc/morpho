// E2E スモークテスト。sim-worker (Web Worker) + Canvas 描画 (差分再描画を
// 含む) + HUD 更新という、ユニットテストでは踏めない「本物のブラウザで
// つなげたときに壊れていないか」を確認する回帰ガード。
// `pnpm run build` 済みの dist を `vite preview` で配信して検証する
// (playwright.config.ts の webServer)。

import { test, expect, type Page } from './fixtures.js';

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

// M15.5: 実プレイ検証で発覚したレイアウト崩れ (ヘッダのはみ出し・ボタンの
// 縦書き潰れ) は要素可視性だけを見る e2e では素通りしていた。
// document.scrollWidth <= innerWidth の1本で headless でも検出できる。
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
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

test('PWA: manifest が配信され、Service Worker が登録・有効化される (M7: オフライン起動の土台)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(manifestHref).toBeTruthy();

  const manifestRes = await page.request.get(manifestHref!);
  expect(manifestRes.ok()).toBe(true);
  const manifest = await manifestRes.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  expect(manifest.icons.length).toBeGreaterThan(0);

  await expect
    .poll(
      async () =>
        page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null),
      { timeout: 15_000 },
    )
    .toBe('activated');

  expect(errors).toEqual([]);
});

test('起動してキャンバスが描画され、コンソールエラーが出ない', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#canvas')).toBeVisible();
  expect(await dayText(page)).toBe('0');
  expect(errors).toEqual([]);

  // M15.5: デスクトップ幅でも「🔁 見守り」トグルがラベル分の横幅を確保できず
  // 縦書きに潰れていた回帰を検出する (潰れると1行あたり十数pxずつ高さが伸びる)。
  await expectNoHorizontalOverflow(page);
  const toggleHeight = await page.locator('#day-loop-mode-toggle').evaluate((el) => el.getBoundingClientRect().height);
  expect(toggleHeight).toBeLessThanOrEqual(40);
});

test('M8 P0: `?debug` を付けると perf HUD が表示され、tick/描画コストと FPS を表示する', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/?debug');
  await waitForReady(page);

  const hud = page.locator('#perf-hud');
  await expect(hud).toBeVisible();
  await expect.poll(async () => (await hud.textContent()) ?? '', { timeout: 10_000 }).toMatch(/FPS \d+/);
  const text = (await hud.textContent()) ?? '';
  expect(text).toMatch(/draw \d+\.\d+ms/);
  expect(text).toMatch(/tick \d+\.\d+ms/);
  expect(text).toMatch(/speed x\d+(\.\d+)? \/ x\d+/);
  expect(errors).toEqual([]);
});

test('`?debug` なしでは perf HUD が生成されない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);
  await expect(page.locator('#perf-hud')).toHaveCount(0);
});

test('放っておくと DAY が進み、キャンバスの絵も変わる (sim-worker が回っている)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
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
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
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
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
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
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  // 進行を確認しやすいよう速度を上げてから停止する。
  await setSpeedSlider(page, 20);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 }).toBeGreaterThan(0);

  await page.click('#pause-toggle');
  await expect(page.locator('#pause-toggle')).toHaveClass(/active/);
  // クリックで送られる setSpeed(0) は sim-worker への非同期メッセージなので、
  // クリック直後はまだ飛行中の tick が1つ残っている可能性がある。それが
  // 着地するのを待ってから基準値を採る (でないと稀に古い進行中の DAY を
  // pausedDay として捉えてしまい、後続の一致チェックがフレーキーになる)。
  await page.waitForTimeout(300);
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
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
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

test('ステージを切り替えると DAY が0に戻り、ステージ名表示が変わる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await setSpeedSlider(page, 20);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 }).toBeGreaterThan(0);

  await page.click('#pause-toggle');
  await expect(page.locator('#pause-toggle')).toHaveClass(/active/);

  await page.selectOption('#stage-select', 'desert');
  await expect(page.locator('#day')).toHaveText('0');
  await expect(page.locator('#stage-name')).toHaveText('砂漠');

  expect(errors).toEqual([]);
});

test('ホイールでズームしてもクラッシュせず、全体を見るボタンで復帰できる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
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

test('M6: 起動時に3つのコロニーが配置され、ミニマップをクリックすると個体ビューにズームする', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#w-colonies')).toHaveText('3');
  await expect(page.locator('#w-networks')).toHaveText('3');

  const beforeChecksum = await canvasChecksum(page);
  const minimap = page.locator('#minimap');
  const box = await minimap.boundingBox();
  if (!box) throw new Error('minimap has no bounding box');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.waitForTimeout(300);
  const afterChecksum = await canvasChecksum(page);

  expect(afterChecksum).not.toBe(beforeChecksum);
  expect(errors).toEqual([]);
});

test('M7: 撮影ボタンでアルバムに追加され、削除ボタンで消せる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#album-count')).toHaveText('0');
  await page.click('#screenshot');
  await expect.poll(async () => (await page.locator('#album-count').textContent())?.trim(), { timeout: 5_000 }).toBe('1');
  await expect(page.locator('.album-shot')).toHaveCount(1);

  await page.click('.album-shot-del');
  await expect(page.locator('#album-count')).toHaveText('0');
  await expect(page.locator('.album-shot')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('M7: 環境音トグルでAudioContextが生成・再開され、ステージ切替でもエラーが出ない', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#toggle-ambient')).not.toHaveClass(/active/);
  await page.click('#toggle-ambient');
  await expect(page.locator('#toggle-ambient')).toHaveClass(/active/);

  await page.selectOption('#stage-select', 'wetland');
  await page.waitForTimeout(300);

  await page.click('#toggle-ambient');
  await expect(page.locator('#toggle-ambient')).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});

test('M8 P3: Day 1 で成長タイムラインに非同期エンコードされたサムネイルが追加される', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await setSpeedSlider(page, 24);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);

  const thumb = page.locator('#timeline .timeline-entry img').first();
  await expect(thumb).toHaveCount(1, { timeout: 10_000 });
  const src = await thumb.getAttribute('src');
  expect(src).toMatch(/^blob:/);

  expect(errors).toEqual([]);
});

test('M8 P4: 早送りモードをONにするとDAYが進み続け、OFFに戻せる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await setSpeedSlider(page, 24);
  await expect(page.locator('#fast-forward')).not.toHaveClass(/active/);
  await page.click('#fast-forward');
  await expect(page.locator('#fast-forward')).toHaveClass(/active/);

  await expect.poll(async () => Number(await dayText(page)), { timeout: 20_000 }).toBeGreaterThan(0);

  await page.click('#fast-forward');
  await expect(page.locator('#fast-forward')).not.toHaveClass(/active/);

  // OFFに戻した後も通常通り進み続ける (Workerのループ間隔が壊れていない)。
  const dayAfterToggleOff = Number(await dayText(page));
  await expect.poll(async () => Number(await dayText(page)), { timeout: 15_000 }).toBeGreaterThan(dayAfterToggleOff);

  expect(errors).toEqual([]);
});

test('Day 5 以降に種を採取すると系統樹に記録され、世代が進む', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await expect(page.locator('#harvest-seed')).toBeDisabled();
  await expect(page.locator('#lineage-gen')).toHaveText('現在 1代目');

  await setSpeedSlider(page, 24);
  await expect.poll(async () => Number(await dayText(page)), { timeout: 20_000 }).toBeGreaterThanOrEqual(5);

  await expect(page.locator('#harvest-seed')).toBeEnabled();
  await page.click('#harvest-seed');

  await expect(page.locator('#lineage-gen')).toHaveText('現在 2代目');
  // M13: 系統樹は分岐ツリー (.lineage-node) になった。
  await expect(page.locator('#lineage .lineage-node').first()).toContainText('1代目');

  expect(errors).toEqual([]);
});
