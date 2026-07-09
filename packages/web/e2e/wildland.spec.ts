// M25: 「原野」(半無限ワールド) の e2e。本物のブラウザ (sim-worker +
// Canvas 描画 + カメラ) で、有界ステージと同じ操作性のまま前線が
// 停滞せず伸び続けることを確認する回帰ガード。
// `pnpm run build` 済みの dist を `vite preview` で配信して検証する
// (playwright.config.ts の webServer)。

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

async function networkLinks(page: Page): Promise<number> {
  const text = (await page.locator('#w-links').textContent()) ?? '0';
  return Number(text.trim());
}

test('原野ステージへ切り替えると前線が停滞せず伸び続ける (エッジ数が単調に近く増加)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    // M25: 待ち時間を圧縮するため、旧 tick レート相当の日長に固定する
    // (fixtures.ts の既定 500ms よりさらに動かしたいので明示的に上書き)。
    localStorage.setItem('morpho.dayMs.v1', '3840');
    // 見守りモードで開始する (デイループ選択モーダルを出さない)。
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
  });
  await page.goto('/');
  await waitForReady(page);

  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');
  await expect(page.locator('#day')).toHaveText('0');

  // ×24 まで速度を上げ、前線が実際に伸び続けることを実測する。
  await page.click('#speed-btn-24');

  const netAt = async (): Promise<number> => {
    await page.waitForTimeout(3000);
    return networkLinks(page);
  };
  const n1 = await netAt();
  const n2 = await netAt();
  const n3 = await netAt();

  // M25 の核心 (forager reclaim): 有界ステージが Day24 相当で完全停滞する
  // のに対し、原野は観察を続ける限りネットワークが伸び続ける。3回のサンプル
  // で単調非減少かつ、最初と最後で明確な増加があることを確認する。
  expect(n2).toBeGreaterThanOrEqual(n1);
  expect(n3).toBeGreaterThanOrEqual(n2);
  expect(n3).toBeGreaterThan(n1);

  expect(errors).toEqual([]);
});

test('原野でツール (エサ) を配置できる (チャンク実座標への書き込み経路)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');

  const before = Number((await page.locator('#w-ct').textContent())?.trim());
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas bounding box not found');
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.3);

  // 'food' ツール (既定選択) の配置で拠点総数が増える — GridEnvironment 直書き
  // ではなく Game.applyWildlandTool() 経由でチャンク実座標へ届いていることの
  // 間接確認 (直書きだと次の tick() 焼き直しで消えてしまい増分が観測できない)。
  // toHaveText は自動リトライするので、apply → Worker 往復 → 次スナップショット
  // の非同期反映を素朴な固定待ちより確実に待てる (smoke.spec.ts と同じ作法)。
  await expect(page.locator('#w-ct')).toHaveText(String(before + 1));
  expect(errors).toEqual([]);
});

// ── M28-B: ズーム再設計 + 大局レイヤー ─────────────────────

// 指定した矩形 (キャンバス比率 0..1) 内のピクセルを間引きサンプリングして
// 「明るい (= 未訪問の暗黒ではない) ピクセル」の数を数える。
async function brightPixelsInRegion(page: Page, fx0: number, fy0: number, fx1: number, fy1: number): Promise<number> {
  return page.evaluate(([rx0, ry0, rx1, ry1]) => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const x0 = Math.floor(canvas.width * rx0!), y0 = Math.floor(canvas.height * ry0!);
    const w = Math.max(1, Math.floor(canvas.width * (rx1! - rx0!)));
    const h = Math.max(1, Math.floor(canvas.height * (ry1! - ry0!)));
    const { data } = ctx.getImageData(x0, y0, w, h);
    let bright = 0;
    for (let i = 0; i < data.length; i += 16) {
      // 未訪問の暗さ (OVERVIEW_VOID_COLOR ≈ rgb(13,17,15)) より明確に明るいか。
      if ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0) > 90) bright++;
    }
    return bright;
  }, [fx0, fy0, fx1, fy1]);
}

// ズームスライダーを動的下限まで動かす (原野では俯瞰素材が届くと min < 1 に
// 下がる — まず min の更新を待つ)。range input への fill() は値の検証で
// 落ちることがあるため、value を直接与えて input イベントを発火する
// (main.ts のリスナは 'input' を見る)。
async function zoomOutToMin(page: Page): Promise<void> {
  const slider = page.locator('#zoom-slider');
  await expect.poll(async () => Number(await slider.getAttribute('min')), { timeout: 15_000 }).toBeLessThan(1);
  await page.evaluate(() => {
    const el = document.getElementById('zoom-slider') as HTMLInputElement;
    el.value = el.min;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('M28: 原野でズームスライダーを最小へ → 窓 (100×100) の外が描かれ、絵が変わる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');

  // 俯瞰の素材 (worldOverview, 約1秒間隔) が届いてスライダー下限が動的化する
  // のを待ってから、まず一時停止して以降の絵を安定させる。
  const slider = page.locator('#zoom-slider');
  await expect.poll(async () => Number(await slider.getAttribute('min')), { timeout: 15_000 }).toBeLessThan(1);
  await page.click('#speed-btn-pause');
  await page.waitForTimeout(400);

  const atZoom1 = await canvasChecksum(page);
  await zoomOutToMin(page);
  await page.waitForTimeout(400);
  const atMinZoom = await canvasChecksum(page);

  // M25 までは MIN_ZOOM=1 固定で「最小ズームでも画面が1ピクセルも変わらない」
  // (docs/playtest-2026-07-09-infinite/ の b-wildland-zoomout.png)。M28 の核心
  // はこれが変わること。
  expect(atMinZoom).not.toBe(atZoom1);
  expect(errors).toEqual([]);
});

test('M28: 成長後にズームアウトすると訪問済みチャンクのタイルが窓の外側に見える', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayMs.v1', '3840');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');

  // ×24 でしばらく成長させ、窓の外へ広がった訪問済みチャンクを作る。
  await page.click('#speed-btn-24');
  await page.waitForTimeout(6000);
  await page.click('#speed-btn-pause');

  await zoomOutToMin(page);
  await page.waitForTimeout(400);

  // 最小ズームでは「訪問済み bbox + 余白 (1.3 倍)」がちょうど収まるので、窓
  // (100×100、常に画面中央の [0.235, 0.765] 以内) の外側の帯に訪問済み
  // チャンクのタイル (未訪問の暗黒より明確に明るい) が描かれている。成長の
  // 方向は seed 次第で偏るため、上下左右4帯の合計で判定する。
  const bands = await Promise.all([
    brightPixelsInRegion(page, 0.0, 0.35, 0.22, 0.65),  // 左帯
    brightPixelsInRegion(page, 0.78, 0.35, 1.0, 0.65),  // 右帯
    brightPixelsInRegion(page, 0.35, 0.0, 0.65, 0.22),  // 上帯
    brightPixelsInRegion(page, 0.35, 0.78, 0.65, 1.0),  // 下帯
  ]);
  expect(bands.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

  // 四隅 (bbox の余白の外 = 未訪問領域) は暗いまま — 「未訪問領域は暗い」の検査。
  const corner = await brightPixelsInRegion(page, 0.0, 0.0, 0.03, 0.03);
  expect(corner).toBe(0);
  expect(errors).toEqual([]);
});
