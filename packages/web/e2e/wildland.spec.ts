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
