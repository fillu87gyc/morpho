// M15: 初回オンボーディング (コンセプトの3ステップ) の e2e。
// このファイルだけは localStorage を汚さず、フレッシュな状態で
// オンボーディングが実際に出ることを確かめる。

import { test, expect, type Page } from './fixtures.js';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

test('初回起動時にオンボーディングが3ステップで表示され、スキップまたは完了すると二度と出ない', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');

  const overlay = page.locator('#onboarding');
  await expect(overlay).toBeVisible();
  await expect(page.locator('#onboarding-step-n')).toHaveText('1/3');

  await page.click('#onboarding-next');
  await expect(page.locator('#onboarding-step-n')).toHaveText('2/3');
  await page.click('#onboarding-next');
  await expect(page.locator('#onboarding-step-n')).toHaveText('3/3');
  await expect(page.locator('#onboarding-next')).toHaveText('はじめる ▶');

  await page.click('#onboarding-next');
  await expect(overlay).toBeHidden();

  // localStorage に既読フラグが立ち、再読み込みしても出ない。
  await page.reload();
  await expect(overlay).toBeHidden();

  expect(errors).toEqual([]);
});

test('スキップを押すとその場でオンボーディングが閉じる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');

  const overlay = page.locator('#onboarding');
  await expect(overlay).toBeVisible();
  await page.click('#onboarding-skip');
  await expect(overlay).toBeHidden();

  await page.reload();
  await expect(overlay).toBeHidden();

  expect(errors).toEqual([]);
});

test('M19: オンボーディング直後の初回だけ「デイループ/見守り」の2択が出て、選ぶとその通りに始まる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');

  await page.click('#onboarding-skip');
  const choice = page.locator('#day-loop-choice');
  await expect(choice).toBeVisible();

  await page.click('#day-loop-choice-loop');
  await expect(choice).toBeHidden();
  // デイループを選ぶと即座に prepare フェーズへ入る (「観察をはじめる」が見える)。
  await expect(page.locator('#begin-observe')).toBeVisible();
  await expect(page.locator('#day-loop-mode-toggle')).toHaveClass(/active/);

  // 既存ユーザー扱いになったので、再読み込みしても2択は二度と出ない。
  await page.reload();
  await expect(page.locator('#onboarding')).toBeHidden();
  await expect(choice).toBeHidden();

  expect(errors).toEqual([]);
});

test('M19: 「見守りで眺める」を選ぶと連続再生のまま始まる', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/');

  await page.click('#onboarding-skip');
  await expect(page.locator('#day-loop-choice')).toBeVisible();
  await page.click('#day-loop-choice-watch');
  await expect(page.locator('#day-loop-choice')).toBeHidden();
  await expect(page.locator('#day-loop-bar')).toBeHidden();
  await expect(page.locator('#day-loop-mode-toggle')).not.toHaveClass(/active/);

  expect(errors).toEqual([]);
});
