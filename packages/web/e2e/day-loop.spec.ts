// M9: デイループ (仕込む → 委ねる → 受け取る) の e2e。
// 既定は「見守り (連続)」のままなので (smoke.spec.ts / mobile.spec.ts を
// 壊さないため)、ここではヘッダのトグルで明示的にデイループへ切り替えてから検証する。

import { test, expect, type Page } from '@playwright/test';

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

test('デイループ: 1日を仕込む→委ねる→結果を受け取る→つぎの日へ、が1周する', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  // まだ見守り (連続) のまま: デイループの帯は隠れている。
  await expect(page.locator('#day-loop-bar')).toBeHidden();

  await page.click('#day-loop-mode-toggle');
  await expect(page.locator('#day-loop-mode-toggle')).toHaveClass(/active/);
  await expect(page.locator('#day-loop-bar')).toBeVisible();

  // prepare: 「観察をはじめる」だけが見え、速度スライダーは無効。
  await expect(page.locator('#begin-observe')).toBeVisible();
  await expect(page.locator('#speed-slider')).toBeDisabled();

  // setSpeed(0) は sim-worker への非同期メッセージなので、クリック直後は
  // まだ飛行中の tick が着地しきっていない可能性がある (smoke.spec.ts の
  // 一時停止テストと同じ理由)。着地を待ってから基準の DAY を採る。
  await page.waitForTimeout(300);
  const dayAtPrepare = (await page.locator('#day').textContent())?.trim() ?? '';

  const preObserveChecksum = await canvasChecksum(page);
  await page.waitForTimeout(500);
  // prepare 中は sim が一時停止しているので、絵は変わらない。
  expect(await canvasChecksum(page)).toBe(preObserveChecksum);

  // 観察をはじめる → 結果パネルが出るまで進む。速度×24 だと1日 (40 tick) は
  // 数百ms 程度で終わりうるため、「残り時間表示」が見える保証はせず
  // (一瞬で結果パネルに切り替わりうる)、最終的に結果が出ることだけ確認する。
  await page.click('#begin-observe');
  await expect(page.locator('#begin-observe')).toBeHidden();

  await expect(page.locator('#day-result-modal')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('#dr-day')).toHaveText(dayAtPrepare);

  // つぎの日へ: 結果パネルが閉じ、再び「観察をはじめる」が現れる (次の prepare)。
  await page.click('#dr-next');
  await expect(page.locator('#day-result-modal')).toBeHidden();
  await expect(page.locator('#begin-observe')).toBeVisible();
  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()))
    .toBeGreaterThan(Number(dayAtPrepare));

  expect(errors).toEqual([]);
});

test('デイループ: 見守り (連続) に戻すと自動で進み続ける', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await waitForReady(page);

  await page.click('#day-loop-mode-toggle');
  await expect(page.locator('#day-loop-bar')).toBeVisible();

  await page.click('#day-loop-mode-toggle');
  await expect(page.locator('#day-loop-mode-toggle')).not.toHaveClass(/active/);
  await expect(page.locator('#day-loop-bar')).toBeHidden();
  await expect(page.locator('#speed-slider')).toBeEnabled();

  await expect.poll(async () => Number((await page.locator('#day').textContent())?.trim()), { timeout: 15_000 })
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
