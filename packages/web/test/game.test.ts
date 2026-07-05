import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

// env.obstacle は FieldGrid (プレーンな Float32Array) で、BiomassField 等の
// ScalarField と違い .sample() を持たない。ワールド座標→最寄りセルの
// 生値を直接読む。
function obstacleAt(g: Game, pos: { x: number; y: number }): number {
  const fs = g.fieldSize;
  const s = fs / g.worldSize;
  const x = Math.min(fs - 1, Math.max(0, Math.floor(pos.x * s)));
  const y = Math.min(fs - 1, Math.max(0, Math.floor(pos.y * s)));
  return g.env.obstacle.data[y * fs + x] ?? 0;
}

describe('Game', () => {
  it('同じseedなら同じtick数だけ進めたときに同じ状態になる', () => {
    const a = new Game(42);
    const b = new Game(42);
    a.setSpeed(1);
    b.setSpeed(1);
    for (let i = 0; i < 60; i++) { a.tick(); b.tick(); }

    const sa = a.snapshot();
    const sb = b.snapshot();
    expect(sa.state.nodes.length).toBe(sb.state.nodes.length);
    expect(sa.state.edges.length).toBe(sb.state.edges.length);
    for (let i = 0; i < sa.state.nodes.length; i++) {
      expect(sa.state.nodes[i]!.pos.x).toBe(sb.state.nodes[i]!.pos.x);
      expect(sa.state.nodes[i]!.pos.y).toBe(sb.state.nodes[i]!.pos.y);
    }
  });

  it('異なるseedなら結果が分岐する', () => {
    const a = new Game(1);
    const b = new Game(2);
    a.setSpeed(1);
    b.setSpeed(1);
    for (let i = 0; i < 60; i++) { a.tick(); b.tick(); }

    const sa = a.snapshot();
    const sb = b.snapshot();
    const same = sa.state.nodes.length === sb.state.nodes.length
      && sa.state.edges.length === sb.state.edges.length;
    expect(same).toBe(false);
  });

  it('reset は同じ seed を渡せば同じ初期状態を再現する', () => {
    const g = new Game(7);
    g.setSpeed(1);
    for (let i = 0; i < 20; i++) g.tick();
    g.reset(7);
    const afterFirstReset = g.snapshot();

    g.reset(7);
    const afterSecondReset = g.snapshot();

    expect(afterFirstReset.state.nodes.length).toBe(afterSecondReset.state.nodes.length);
    expect(afterFirstReset.day).toBe(0);
    expect(afterFirstReset.world.coloniesTotal).toBe(6);
  });

  it('speed=0 だと tick() を呼んでも sim tick が進まない', () => {
    const g = new Game(3);
    g.setSpeed(0);
    const before = g.snapshot().state.tick;
    for (let i = 0; i < 10; i++) g.tick();
    expect(g.snapshot().state.tick).toBe(before);
  });

  it('day は state.tick / 40 切り捨て、時代は条件達成 (拠点接続等) に応じて進む (M14)', () => {
    const g = new Game(11);
    g.setSpeed(1);
    const eraNames = new Set<string>();
    for (let i = 0; i < 400; i++) {
      g.tick();
      eraNames.add(g.snapshot().era.name);
    }
    expect(g.snapshot().day).toBe(10);
    // 起動直後の胞子期は必ず観測されているはず。
    expect(eraNames.has('胞子期')).toBe(true);
    // 400 tick も経てば、最初の拠点接続 (拡散期) 以上には進んでいるはず。
    expect(['拡散期', '変形体期', '成熟期']).toContain(g.snapshot().era.name);
    expect(g.snapshot().era.progress).toBeGreaterThanOrEqual(0);
    expect(g.snapshot().era.progress).toBeLessThanOrEqual(1);
  });

  it('food ツールを適用すると拠点総数が増え、イベントログに記録される', () => {
    const g = new Game(5);
    g.setTool('food');
    g.setBrush(4);
    const before = g.snapshot().world.coloniesTotal;
    g.apply({ x: 10, y: 10 });
    const after = g.snapshot();
    expect(after.world.coloniesTotal).toBe(before + 1);
    expect(g.events()[0]?.text).toContain('栄養を撒いた');
  });

  it('stone ツールを適用すると障害物フィールドに値が乗る', () => {
    const g = new Game(5);
    g.setTool('stone');
    g.setBrush(5);
    const pos = { x: 60, y: 60 };
    g.apply(pos);
    expect(obstacleAt(g, pos)).toBeGreaterThan(0);
  });

  it('erase ツールは配置済みの地形をゼロに戻す', () => {
    const g = new Game(5);
    g.setTool('stone');
    g.setBrush(5);
    const pos = { x: 60, y: 60 };
    g.apply(pos);
    expect(obstacleAt(g, pos)).toBeGreaterThan(0);

    g.setTool('erase');
    g.setBrush(6);
    g.apply(pos);
    expect(obstacleAt(g, pos)).toBe(0);
  });

  it('snapshot の balance / traits は常に [0,1] の範囲に収まる', () => {
    const g = new Game(21);
    g.setSpeed(1);
    for (let i = 0; i < 100; i++) g.tick();
    const s = g.snapshot();
    for (const v of Object.values(s.balance)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(s.traits.exploration).toBeGreaterThanOrEqual(0);
    expect(s.traits.exploration).toBeLessThanOrEqual(1);
    expect(s.quests.length).toBeGreaterThan(0);
    for (const q of s.quests) {
      expect(q.progress).toBeGreaterThanOrEqual(0);
      expect(q.progress).toBeLessThanOrEqual(1);
    }
  });

  it('メインクエストは拠点接続と探索度から進捗が計算される', () => {
    const g = new Game(21);
    g.setSpeed(1);
    for (let i = 0; i < 100; i++) g.tick();
    const s = g.snapshot();
    const connect = s.quests.find((q) => q.id === 'connect-all');
    const explore = s.quests.find((q) => q.id === 'explore-70');
    expect(connect).toBeDefined();
    expect(explore).toBeDefined();
    expect(connect!.done).toBe(connect!.progress >= 1);
    expect(explore!.done).toBe(explore!.progress >= 1);
  });

  it('同じ seed なら同じ genome / タイプが再現される', () => {
    const a = new Game(55);
    const b = new Game(55);
    expect(a.genome).toEqual(b.genome);
    expect(a.snapshot().typeInfo).toEqual(b.snapshot().typeInfo);
  });

  it('parentGenome を渡すと、その遺伝子を継承した (=完全に独立ではない) genome になる', () => {
    const parent = new Game(1).genome;
    const independent = new Game(2).genome;
    const child = new Game(2, 'petri', parent).genome;
    // 独立生成した genome とは異なる一方、親から大きく外れてもいない。
    expect(child).not.toEqual(independent);
    const distance = (g: typeof parent) => (Object.keys(parent) as (keyof typeof parent)[])
      .reduce((sum, k) => sum + Math.abs(g[k] - parent[k]), 0);
    expect(distance(child)).toBeLessThan(distance(independent));
  });

  it('同じ parentGenome + seed なら決定的に同じ子 genome になる', () => {
    const parent = new Game(1).genome;
    const a = new Game(3, 'petri', parent).genome;
    const b = new Game(3, 'petri', parent).genome;
    expect(a).toEqual(b);
  });

  it('reset に parentGenome を渡すと以後の個体もその遺伝子を継承する', () => {
    const parent = new Game(1).genome;
    const g = new Game(9);
    g.reset(9, 'petri', parent);
    const independent = new Game(9).genome;
    expect(g.genome).not.toEqual(independent);
  });

  it('個体ビュー (individuality) の全軸は [0,1] に収まる', () => {
    const g = new Game(8);
    g.setSpeed(1);
    for (let i = 0; i < 200; i++) g.tick();
    const ind = g.snapshot().individuality;
    for (const v of Object.values(ind)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('era が切り替わった節目が進化の記録に残る', () => {
    const g = new Game(11);
    g.setSpeed(1);
    for (let i = 0; i < 400; i++) g.tick();
    const evo = g.evolution();
    expect(evo.some((e) => e.text.includes('に入った'))).toBe(true);
    // 起動直後の胞子期そのものは「切り替わり」ではないので記録されない。
    expect(evo.some((e) => e.text === '胞子期に入った')).toBe(false);
  });

  it('ステージを指定して生成でき、snapshot に反映される', () => {
    const g = new Game(9, 'desert');
    expect(g.snapshot().stage.id).toBe('desert');
    expect(g.snapshot().stage.name).toBe('砂漠');
  });

  it('同じ seed でもステージが違えば地形 (障害物量) が変わりうる', () => {
    const petri = new Game(3, 'petri');
    const ruins = new Game(3, 'ruins');
    const sum = (g: Game) => g.env.obstacle.data.reduce((a, b) => a + b, 0);
    expect(sum(ruins)).not.toBe(sum(petri));
  });

  it('reset にステージを渡すとステージが切り替わり、省略すると現在のステージを保つ', () => {
    const g = new Game(4, 'petri');
    g.reset(4, 'cave');
    expect(g.snapshot().stage.id).toBe('cave');
    g.reset(4);
    expect(g.snapshot().stage.id).toBe('cave');
  });

  it('M6: 起動時に複数のコロニー (source) が大マップに配置される', () => {
    const g = new Game(5);
    const s = g.snapshot();
    const sources = s.state.nodes.filter((n) => n.type === 'source');
    expect(sources.length).toBe(3);
    expect(s.world.sourceColonies).toBe(3);
    expect(s.colonyMarkers.length).toBe(3);
  });

  it('M6: 起動直後は各コロニーが独立したネットワークとして数えられる', () => {
    const g = new Game(5);
    const s = g.snapshot();
    expect(s.world.connectedNetworks).toBe(3);
    const ids = new Set(s.colonyMarkers.map((m) => m.networkId));
    expect(ids.size).toBe(3);
  });

  it('放置すると栄養場の総量が自然に減っていく (自然減衰)', () => {
    const g = new Game(15, 'desert');
    g.setSpeed(1);
    const sumNutrients = () => g.env.nutrients.data.reduce((a, b) => a + b, 0);
    const before = sumNutrients();
    for (let i = 0; i < 300; i++) g.tick();
    const after = sumNutrients();
    expect(after).toBeLessThan(before);
  });

  // M10: 温度・毒素ツールと Undo。
  it('heat/cool ツールは温度フィールドを上げ下げする', () => {
    const g = new Game(5);
    const pos = { x: 40, y: 40 };
    const at = () => {
      const s = g.fieldSize / g.worldSize;
      const idx = Math.floor(pos.y * s) * g.fieldSize + Math.floor(pos.x * s);
      return g.env.temperature.data[idx] ?? 0;
    };
    const base = at();
    g.setTool('heat');
    g.setBrush(4);
    g.apply(pos);
    expect(at()).toBeGreaterThan(base);

    g.reset(5);
    g.setTool('cool');
    g.setBrush(4);
    g.apply(pos);
    expect(at()).toBeLessThan(base);
  });

  it('toxin ツールは毒素フィールドに値を乗せ、環境バランスの toxin に反映される', () => {
    const g = new Game(5);
    g.setTool('toxin');
    g.setBrush(6);
    g.apply({ x: 50, y: 50 });
    expect(g.snapshot().balance.toxin).toBeGreaterThan(0);
  });

  it('drain ツールは湿度フィールドを baseMoisture より下げる', () => {
    const g = new Game(5);
    const pos = { x: 45, y: 45 };
    const s = g.fieldSize / g.worldSize;
    const idx = Math.floor(pos.y * s) * g.fieldSize + Math.floor(pos.x * s);
    const before = g.env.moisture.data[idx] ?? 0;
    g.setTool('drain');
    g.setBrush(6);
    g.apply(pos);
    expect(g.env.moisture.data[idx]).toBeLessThan(before);
  });

  it('やり直す (undo) は直前のひと塗りを取り消す', () => {
    const g = new Game(5);
    const pos = { x: 60, y: 60 };
    g.setTool('stone');
    g.setBrush(5);
    g.beginStroke();
    g.apply(pos);
    g.endStroke();
    expect(obstacleAt(g, pos)).toBeGreaterThan(0);

    g.undoStroke();
    expect(obstacleAt(g, pos)).toBe(0);
  });

  it('何もしていない状態で undo しても安全 (no-op)', () => {
    const g = new Game(5);
    expect(() => g.undoStroke()).not.toThrow();
    expect(g.canUndo).toBe(false);
  });
});
