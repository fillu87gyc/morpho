// M16.5: 絵作りの退行検知。
//
// 完全なピクセル差分スナップショット (toHaveScreenshot) は、seed が
// Math.random() 由来で毎回変わる (game.ts の reset()) ため決定的な基準画像を
// 作れず、環境間のフォント/GPU差でも簡単に割れる。M15.5 の「実機でしか
// 検証できないと思っていたものが headless の数値検査で足りた」という
// 教訓を踏襲し、ここでも「モックアップとの最大の印象差だった黒潰れが
// 再発していないか」を平均輝度の閾値で検査する (見た目の絶対的な良し悪しは
// 目視でしか判定できないが、「また真っ黒に戻っていないか」は数値で守れる)。
import { test, expect } from './fixtures.js';

async function averageLuma(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4 * 37) {
      sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    return sum / n;
  });
}

test('皿ステージのフィールドが黒潰れしていない (平均輝度が閾値を超える)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await page.waitForTimeout(500);
  const luma = await averageLuma(page);
  // M16.5 前 (地形テクスチャがほぼ近黒背景だった頃) は平均輝度が20前後だった。
  // 地形ベース色を明るくした後は皿ステージの苔色ベースで40は超える。
  expect(luma).toBeGreaterThan(35);
});

test('大陸ステージのフィールドも黒潰れしていない', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('morpho.onboarded.v1', '1'));
  await page.goto('/');
  await page.selectOption('#stage-select', 'continent');
  await page.click('#reset');
  await page.waitForTimeout(500);
  const luma = await averageLuma(page);
  expect(luma).toBeGreaterThan(35);
});
