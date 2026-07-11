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

test('原野ステージへ切り替えると前線が停滞せず伸び続ける (探索チャンク数が増加)', async ({ page }) => {
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

  // M25 の核心 (forager reclaim): 有界ステージが Day24 相当で完全停滞する
  // のに対し、原野は観察を続ける限り新しい土地を踏み続ける。指標は
  // 「探索チャンク数」(#w-chunks、touched の累計 = 定義上単調非減少) —
  // M25 当初はエッジ数の単調増加を見ていたが、M30 の距離コスト勾配で
  // 「伸びすぎた遠征枝が枯れて戻る」(エッジ数の一時減少) が仕様になった
  // ため、前線の前進そのものを数える指標へ切り替えた。開始直後は初期窓の
  // 焼き込みぶん (3×3 チャンク) で止まって見えるので、固定間隔サンプリング
  // ではなく「増えるまで待つ」を2回続けて前進を確認する。
  test.setTimeout(150_000);
  const chunksNow = async (): Promise<number> =>
    Number(((await page.locator('#w-chunks').textContent()) ?? '0').trim());
  const c1 = await chunksNow();
  await expect.poll(chunksNow, { timeout: 60_000 }).toBeGreaterThan(c1);
  const c2 = await chunksNow();
  await expect.poll(chunksNow, { timeout: 60_000 }).toBeGreaterThan(c2);

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

// ── M29: 休眠 + 稠密化抑制 — 実効ペースが劣化しない ─────────────

test('M29: ×24 で60秒回しても日の進みが極端に鈍化しない (前半30秒 vs 後半30秒)', async ({ page }) => {
  // 60秒の実測 + 起動/切替のマージン。
  test.setTimeout(120_000);
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

  const dayNow = async (): Promise<number> =>
    Number(((await page.locator('#day').textContent()) ?? '0').trim());

  await page.click('#speed-btn-24');
  const d0 = await dayNow();
  await page.waitForTimeout(30_000);
  const d1 = await dayNow();
  await page.waitForTimeout(30_000);
  const d2 = await dayNow();

  const firstHalf = d1 - d0;
  const secondHalf = d2 - d1;
  // M29 前の出荷構成では、窓内が迷路化 (エッジ約7,000本) して tick コストが
  // 日を追うごとに膨らみ、後半のペースは前半の 1/4 以下まで落ちていた
  // (第5回実測: 2.1秒/日 → 45〜60秒/日)。M29 (休眠 + evict + 横芽の絞り) 後は
  // tick コストが前線サイズ比例で頭打ちになるため、後半も前半と同程度の
  // ペースを保つ。CI の負荷ゆらぎは前後半に等しく乗るので比で判定し、
  // しきい値は実測 (~0.9-1.0) に対して 0.5 と保守的に取る (フレーク耐性)。
  expect(firstHalf).toBeGreaterThanOrEqual(3);
  expect(secondHalf / firstHalf).toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

// ── M30: バイオーム — 俯瞰で色の違いが見える ─────────────────

test('M30: 原野のバイオームが生成され、俯瞰タイルに複数の色が見える', async ({ page }) => {
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

  // ×24 でしばらく成長させ、母体の森 (3×3 チャンク) の外まで踏み出させる —
  // バイオームはチャンクを踏んだときに初めて俯瞰へ現れる (遅延生成)。
  await page.click('#speed-btn-24');
  await page.waitForTimeout(8000);
  await page.click('#speed-btn-pause');

  await zoomOutToMin(page);
  await page.waitForTimeout(400);

  // 画面全体を間引きサンプリングし、未訪問の暗黒とバイオマスの金色の光を
  // 除いた「タイルの地色」を 32 階調に量子化して数える。バイオーム
  // (豊かな森 = 明るい苔 / 荒地 = 暗い苔 / 岩場 = 無彩色 / 毒 = 紫 /
  // 水辺 = 青) が生成されていれば、複数の色クラスタが必ず現れる。
  // biomeAt はチャンク座標 + worldSeed の純粋関数 (決定論は vitest 側
  // biomes.test.ts で担保) なので、ここでは「絵として見えている」ことを守る。
  const distinctColors = await page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map<string, number>();
    for (let i = 0; i < data.length; i += 32) {
      const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
      if (r + g + b < 90) continue; // 未訪問の暗黒 (OVERVIEW_VOID_COLOR)
      if (r > 200 && g > 170) continue; // バイオマスの金色の光は地色ではない
      const key = `${r >> 5}:${g >> 5}:${b >> 5}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    // ノイズ (アンチエイリアスの縁) を除くため、十分な画素数のある色だけ数える。
    return [...buckets.values()].filter((n) => n >= 8).length;
  });
  expect(distinctColors).toBeGreaterThanOrEqual(3);
  expect(errors).toEqual([]);
});

// ── M31: 介入カーブ — 極小スタート / 見守り収入 / 大局介入 ─────────

test('M31: 原野の新規開始は極小 (リンク数が閾値以下で始まる)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
    // ほぼ tick が進まない日長 (製品既定値) にして「開始直後」を観測する。
    localStorage.setItem('morpho.dayMs.v1', '144000');
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');
  await page.click('#speed-btn-pause');

  // M31 前は開始 1 日で約 90 リンク (胞子6本枝 + 母体の森 約18パッチ)。
  // 極小スタートは source 1 + 枝 2 本 = リンク 2 から始まる (数 tick の
  // 成長猶予を見ても 12 を超えない)。
  const links = Number(((await page.locator('#w-links').textContent()) ?? '99').trim());
  expect(links).toBeLessThanOrEqual(12);
  await expect(page.locator('#w-ct')).toHaveText('1');
  expect(errors).toEqual([]);
});

test('M31: 見守りモードで放置すると通貨 (🪙) が増える', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
    // fixtures の既定 (500ms/日) のまま = 数十秒で数十日ぶんの見守りになる。
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');
  await page.click('#speed-btn-24');

  const sizuku = async (): Promise<number> =>
    Number((((await page.locator('#cur-sizuku').textContent()) ?? '0').trim()).replace(/,/g, ''));
  const before = await sizuku();
  // 日次の基本給 (+6/日) と新チャンク到達 (+2/枚) が積もる。M31 前は
  // 見守りでは何日回しても残高が 1 も増えなかった (ROADMAP.md V8)。
  await expect.poll(sizuku, { timeout: 90_000 }).toBeGreaterThan(before);
  expect(errors).toEqual([]);
});

test('M31: 俯瞰でマクロツールへ切り替わり、購入・適用で残高が減って効果が見える', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');

  // 俯瞰素材が届いてから止め、最小ズームへ (M28 のテストと同じ作法)。
  const slider = page.locator('#zoom-slider');
  await expect.poll(async () => Number(await slider.getAttribute('min')), { timeout: 15_000 }).toBeLessThan(1);
  await page.click('#speed-btn-pause');
  await zoomOutToMin(page);

  // ツールバーが入れ替わる: 窓内ブラシは隠れ、マクロツールが現れる (誤爆防止)。
  const rainBtn = page.locator('.palette button.macro-tool[data-macro="rain"]');
  await expect(rainBtn).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.palette button.tool[data-tool="food"]')).toBeHidden();

  const sizuku = async (): Promise<number> =>
    Number((((await page.locator('#cur-sizuku').textContent()) ?? '0').trim()).replace(/,/g, ''));
  const before = await sizuku();
  const checksumBefore = await canvasChecksum(page);

  await rainBtn.click();
  const canvas = page.locator('#canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas bounding box not found');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  // 「雨季を呼ぶ」は 🪙20 (SIZUKU_FLOOR と同額 = 詰み防止の常時購入可能枠)。
  await expect.poll(sizuku, { timeout: 10_000 }).toBe(before - 20);
  // 効果範囲の円 + 残り日数ラベルが大局レイヤーに描かれ、絵が変わる。
  await expect.poll(async () => canvasChecksum(page), { timeout: 10_000 }).not.toBe(checksumBefore);
  expect(errors).toEqual([]);
});

// ── M32: 原野を本編に — 目標系と記録系の全面接続 ───────────────────

test('M32: 原野の時代が実際に進む (拠点数ベースの旧条件では止まらない)', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');
  await expect(page.locator('#era')).toHaveText('胞子期');

  await page.click('#speed-btn-24');
  // M25〜M31 の時代判定 (eraFor、拠点数ベース) だと「もう1拠点に到達」が
  // 構造的に満たせず拡散期で恒久停止していた (ROADMAP.md V9)。M32 の
  // wildlandEraFor は到達距離・探索チャンク数・発見バイオーム数で刻むため、
  // 実際に胞子期から先へ進む。
  await expect.poll(async () => page.locator('#era').textContent(), { timeout: 120_000 })
    .not.toBe('胞子期');
  expect(errors).toEqual([]);
});

test('M32: 開始直後に自動達成されるチャレンジが無い', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
    localStorage.setItem('morpho.dayMs.v1', '144000'); // ほぼ tick が進まない (開始直後を観測)
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');
  await page.click('#speed-btn-pause');

  // 有界6ステージの3種 (拠点数ベースの connectProgress に依存する
  // fastest/cheapest/clean) は隠され、原野専用の反復チャレンジ1件に
  // 切り替わる。開始直後はまだ何も達成していない (0/1、「挑戦中」表示)。
  await expect(page.locator('#chal-progress')).toHaveText('0/1');
  await expect(page.locator('#chal-list li')).toHaveCount(1);
  await expect(page.locator('#chal-list .challenge-status')).not.toHaveClass(/done/);
  // 実プレイ検証で見つけた回帰の再発防止: 未達成なのに文言だけ「達成✓」に
  // なっていないか (class は正しく外れていても、テキストが食い違っていた
  // ことがあった)。
  await expect(page.locator('#chal-list .challenge-status')).not.toHaveText(/達成/);
  expect(errors).toEqual([]);
});

test('M32: 図鑑に原野個体が収録される (42枠、原野ぶんの標準エントリを含む)', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem('morpho.onboarded.v1', '1');
    localStorage.setItem('morpho.dayLoopMode.v1', '0');
    localStorage.setItem('morpho.dayMs.v1', '3840'); // 旧 tick レート相当、日進行を速める
  });
  await page.goto('/');
  await waitForReady(page);
  await page.selectOption('#stage-select', 'wildland');
  await expect(page.locator('#stage-name')).toHaveText('原野');

  // M32: STAGE_ORDER に原野が加わり、図鑑は37枠→42枠に拡張された。
  await expect(page.locator('#ency-progress')).toHaveText('0/42');
  await expect(page.locator('.ency-slot')).toHaveCount(42);

  await page.click('#speed-btn-24');
  // 図鑑への記録は Day 3 以降 (main.ts、育ちが浅いうちは個性が定まらない)。
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(3);
  await expect.poll(async () => page.locator('.ency-slot.discovered').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.locator('#ency-progress')).not.toHaveText('0/42');
  expect(errors).toEqual([]);
});
