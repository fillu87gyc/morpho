// M8 P2: nodes/edges の Float32Array パック/アンパックが往復して
// 値を保つことを確認する (postMessage の transferable 化の前提)。
//
// Float32 は Float64 (JS の number) より仮数部が短いため、変換は
// 相対誤差 ~1e-7 程度の丸めを生む (id/type/座標のような整数〜数十の
// 値では問題にならない)。render.ts での描画用途では無視できる誤差だが、
// テストは丸めを織り込んで toBeCloseTo で比較する。

import { describe, it, expect } from 'vitest';
import { packNodes, packEdges, unpackNodes, unpackEdges } from '../src/snapshot-codec.js';
import type { SimEdge, SimNode } from '@morpho/sim';

describe('snapshot-codec', () => {
  it('packNodes/unpackNodes は値を (Float32精度で) 保って往復する', () => {
    const nodes: SimNode[] = [
      { id: 0, pos: { x: 1.5, y: -2.25 }, type: 'source', bornAt: 0 },
      { id: 3, pos: { x: 50, y: 99.75 }, type: 'sink', bornAt: 40 },
      { id: 7, pos: { x: 0, y: 0 }, type: 'relay', bornAt: 120 },
    ];
    const round = unpackNodes(packNodes(nodes));
    expect(round.length).toBe(nodes.length);
    round.forEach((n, i) => {
      const orig = nodes[i]!;
      expect(n.id).toBe(orig.id);
      expect(n.type).toBe(orig.type);
      expect(n.bornAt).toBe(orig.bornAt);
      expect(n.pos.x).toBeCloseTo(orig.pos.x, 5);
      expect(n.pos.y).toBeCloseTo(orig.pos.y, 5);
    });
  });

  it('空配列も扱える', () => {
    expect(unpackNodes(packNodes([]))).toEqual([]);
    expect(unpackEdges(packEdges([]))).toEqual([]);
  });

  it('packEdges/unpackEdges は値を (Float32精度で) 保って往復する', () => {
    const edges: SimEdge[] = [
      { id: 0, from: 0, to: 1, length: 3.5, bornAt: 0, flux: 1.2, radius: 0.8, activity: 0.5, fatigue: 0.1, stress: 0.02 },
      { id: 4, from: 2, to: 5, length: 10, bornAt: 80, flux: 0, radius: 2.4, activity: 0.99, fatigue: 3.3, stress: 1.1 },
    ];
    const round = unpackEdges(packEdges(edges));
    expect(round.length).toBe(edges.length);
    round.forEach((e, i) => {
      const orig = edges[i]!;
      expect(e.id).toBe(orig.id);
      expect(e.from).toBe(orig.from);
      expect(e.to).toBe(orig.to);
      expect(e.bornAt).toBe(orig.bornAt);
      expect(e.length).toBeCloseTo(orig.length, 5);
      expect(e.flux).toBeCloseTo(orig.flux, 5);
      expect(e.radius).toBeCloseTo(orig.radius, 5);
      expect(e.activity).toBeCloseTo(orig.activity, 5);
      expect(e.fatigue).toBeCloseTo(orig.fatigue, 5);
      expect(e.stress).toBeCloseTo(orig.stress, 5);
    });
  });
});
