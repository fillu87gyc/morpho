import { describe, it, expect } from 'vitest';
import { ChunkedGridEnvironment } from '../src/env/chunked-environment.js';
import { bakeChunkWindow, followWindowOrigin } from '../src/env/chunk-window.js';

describe('bakeChunkWindow', () => {
  it('窓ローカル座標で source と同じ値をサンプルできる', () => {
    const source = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 1 });
    source.placeFood({ x: 520, y: 480 }, 10, 1.0);
    const grid = bakeChunkWindow(source, { x: 400, y: 400 }, { span: 300, fieldSize: 96 });
    // ワールド座標 (520,480) は窓ローカルでは (120,80)。
    const local = grid.sampleGrowthContext({ x: 120, y: 80 });
    const real = source.sampleGrowthContext({ x: 520, y: 480 });
    expect(local.nutrients).toBeCloseTo(real.nutrients, 1);
  });

  it('target を渡すと (span/fieldSize が一致する限り) 再利用する', () => {
    const source = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 2 });
    const first = bakeChunkWindow(source, { x: 0, y: 0 }, { span: 300, fieldSize: 96 });
    const second = bakeChunkWindow(source, { x: 300, y: 0 }, { span: 300, fieldSize: 96 }, first);
    expect(second).toBe(first);
  });

  it('span/fieldSize が変わると再利用せず新規に作る', () => {
    const source = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 3 });
    const first = bakeChunkWindow(source, { x: 0, y: 0 }, { span: 300, fieldSize: 96 });
    const second = bakeChunkWindow(source, { x: 0, y: 0 }, { span: 200, fieldSize: 96 }, first);
    expect(second).not.toBe(first);
    expect(second.worldSize).toBe(200);
  });

  it('obstacle/water など他フィールドも焼き出す', () => {
    const source = new ChunkedGridEnvironment({ worldSize: 100_000, worldSeed: 4 });
    source.placeStone({ x: 150, y: 150 }, 4);
    const grid = bakeChunkWindow(source, { x: 100, y: 100 }, { span: 300, fieldSize: 96 });
    const local = grid.sampleGrowthContext({ x: 50, y: 50 });
    expect(local.obstacle).toBeGreaterThan(0.5);
  });
});

describe('followWindowOrigin', () => {
  const SPAN = 300;

  it('bbox が窓の中央付近なら再センタリングしない (null)', () => {
    const origin = { x: 0, y: 0 };
    const nodes = [{ x: 140, y: 140 }, { x: 160, y: 160 }];
    expect(followWindowOrigin(origin, nodes, SPAN, 0.2)).toBeNull();
  });

  it('bbox が margin 内 (縁付近) に来たら bbox 中心が窓中心になる新 origin を返す', () => {
    const origin = { x: 0, y: 0 };
    // margin=0.2 → 60 ワールド単位以内が「縁」。x=290 は右縁 (300) まで 10 しかない。
    const nodes = [{ x: 150, y: 150 }, { x: 290, y: 150 }];
    const next = followWindowOrigin(origin, nodes, SPAN, 0.2);
    expect(next).not.toBeNull();
    const cx = (150 + 290) / 2;
    expect(next!.x).toBeCloseTo(cx - SPAN / 2, 6);
    expect(next!.y).toBeCloseTo(150 - SPAN / 2, 6);
  });

  it('ノードが無ければ null (追従対象がない)', () => {
    expect(followWindowOrigin({ x: 0, y: 0 }, [], SPAN, 0.2)).toBeNull();
  });

  it('新しい origin では bbox が窓の中央に来る (次呼び出しで再び null になる)', () => {
    const origin = { x: 0, y: 0 };
    const nodes = [{ x: 150, y: 150 }, { x: 290, y: 150 }];
    const next = followWindowOrigin(origin, nodes, SPAN, 0.2)!;
    // 再センタリング後、同じ nodes に対しては再センタリング不要になるはず。
    expect(followWindowOrigin(next, nodes, SPAN, 0.2)).toBeNull();
  });
});
