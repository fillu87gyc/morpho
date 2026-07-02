import { describe, it, expect, vi } from 'vitest';
import { MultiLayerDirtyTracker } from '../src/field-diff.js';

function makeLayer(size: number, fill = 0): Float32Array {
  return new Float32Array(size * size).fill(fill);
}

describe('MultiLayerDirtyTracker', () => {
  it('初回呼び出しは全セルを差分として扱う (force を渡さなくても)', () => {
    const size = 4;
    const tracker = new MultiLayerDirtyTracker(size, 1, 0.01);
    const layer = makeLayer(size, 0.5);
    const onDirty = vi.fn();
    const rect = tracker.update([layer], false, onDirty);

    expect(rect).toEqual({ x0: 0, y0: 0, x1: size - 1, y1: size - 1 });
    expect(onDirty).toHaveBeenCalledTimes(size * size);
    expect(tracker.initialized).toBe(true);
  });

  it('閾値未満の変化はセルを再描画しない', () => {
    const size = 4;
    const tracker = new MultiLayerDirtyTracker(size, 1, 0.01);
    const layer = makeLayer(size, 0.5);
    tracker.update([layer], false, () => {});

    layer[5] = 0.505; // delta = 0.005 < eps(0.01)
    const onDirty = vi.fn();
    const rect = tracker.update([layer], false, onDirty);

    expect(rect).toBeNull();
    expect(onDirty).not.toHaveBeenCalled();
  });

  it('閾値を超える変化があったセルだけを外接矩形付きで報告する', () => {
    const size = 8;
    const tracker = new MultiLayerDirtyTracker(size, 1, 0.01);
    const layer = makeLayer(size, 0);
    tracker.update([layer], false, () => {});

    // (x=2,y=1) と (x=5,y=6) だけを変化させる。
    layer[1 * size + 2] = 1;
    layer[6 * size + 5] = 1;
    const dirtyCells: Array<[number, number]> = [];
    const rect = tracker.update([layer], false, (_i, x, y) => dirtyCells.push([x, y]));

    expect(rect).toEqual({ x0: 2, y0: 1, x1: 5, y1: 6 });
    expect(dirtyCells).toEqual([[2, 1], [5, 6]]);
  });

  it('force=true は変化がなくても全セルを再描画する', () => {
    const size = 3;
    const tracker = new MultiLayerDirtyTracker(size, 1, 0.01);
    const layer = makeLayer(size, 0.2);
    tracker.update([layer], false, () => {});

    const onDirty = vi.fn();
    const rect = tracker.update([layer], true, onDirty);

    expect(rect).toEqual({ x0: 0, y0: 0, x1: size - 1, y1: size - 1 });
    expect(onDirty).toHaveBeenCalledTimes(size * size);
  });

  it('複数レイヤのうち1つでも閾値を超えれば差分扱いになる', () => {
    const size = 3;
    const tracker = new MultiLayerDirtyTracker(size, 2, 0.01);
    const a = makeLayer(size, 0);
    const b = makeLayer(size, 0);
    tracker.update([a, b], false, () => {});

    b[4] = 1; // 2枚目のレイヤだけ変化
    const dirtyCells: number[] = [];
    const rect = tracker.update([a, b], false, (i) => dirtyCells.push(i));

    expect(rect).toEqual({ x0: 1, y0: 1, x1: 1, y1: 1 });
    expect(dirtyCells).toEqual([4]);
  });

  // 回帰テスト: render.ts で実際に踏んだバグ。基準値を「前フレームの生値」で
  // 更新すると、毎フレーム閾値未満のゆっくりした変化 (biomass の指数減衰など)
  // が無限に見逃され続け、実際の値と表示がどんどん乖離してしまう。
  // 基準値は「最後に実際に塗った値」で更新しなければならない。
  it('閾値未満の変化が積み重なっても、乖離が閾値を超えた時点で必ず検出する', () => {
    const size = 2;
    const tracker = new MultiLayerDirtyTracker(size, 1, 0.01);
    const layer = makeLayer(size, 1.0);
    tracker.update([layer], false, () => {}); // baseline = 1.0 (最初は全面塗る)

    // 毎フレーム 0.005 ずつ減衰させる (閾値 0.01 未満)。
    // baseline が「最後に塗った値」のままなら、40 フレーム後には
    // 累積 delta が 0.2 に達し、いずれ閾値を超えて検出されるはず。
    let detected = false;
    for (let frame = 0; frame < 40; frame++) {
      layer[0] = (layer[0] ?? 0) - 0.005;
      const dirty = tracker.update([layer], false, () => {});
      if (dirty) { detected = true; break; }
    }

    expect(detected).toBe(true);
  });

  it('（対照実験）基準値を毎フレーム生値で更新する誤実装だと上記の乖離を永遠に見逃す', () => {
    // MultiLayerDirtyTracker と同じ eps だが、baseline を「前フレームの生値」で
    // 更新する誤ったバリアントを再現し、真に無限見逃しが起きることを確認する
    // (= 上のテストが実際にこのクラスのバグを捕まえられることの裏付け)。
    const eps = 0.01;
    let baseline = 1.0;
    let current = 1.0;
    let everDirty = false;
    for (let frame = 0; frame < 200; frame++) {
      current -= 0.005;
      const changed = Math.abs(current - baseline) > eps;
      if (changed) everDirty = true;
      baseline = current; // ← バグのある更新方法
    }
    expect(everDirty).toBe(false);
  });
});
