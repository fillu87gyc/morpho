import { describe, it, expect, beforeEach } from 'vitest';
import { Scoreboard } from '../src/scoreboard.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function mockStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
  };
}

function setGlobalStorage(s: StorageLike | undefined): void {
  const g = globalThis as unknown as { localStorage?: StorageLike };
  if (s) g.localStorage = s;
  else delete g.localStorage;
}

describe('Scoreboard', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('初回の記録はそのままベスト記録になる', () => {
    const s = new Scoreboard();
    s.record('petri', '皿', { connectProgress: 0, day: 5, compositeScore: 0.4, massKg: 1.2, areaM2: 300 });
    const rec = s.list()[0]!;
    expect(rec.bestScore).toBe(0.4);
    expect(rec.bestMassKg).toBe(1.2);
    expect(rec.bestAreaM2).toBe(300);
    expect(rec.bestConnectDay).toBeNull();
  });

  it('全拠点接続すると bestConnectDay が記録され、以後はより短い日数だけ更新する', () => {
    const s = new Scoreboard();
    s.record('petri', '皿', { connectProgress: 1, day: 20, compositeScore: 0.5, massKg: 1, areaM2: 100 });
    expect(s.list()[0]!.bestConnectDay).toBe(20);
    s.record('petri', '皿', { connectProgress: 1, day: 25, compositeScore: 0.5, massKg: 1, areaM2: 100 });
    expect(s.list()[0]!.bestConnectDay).toBe(20); // 悪化するので更新しない
    s.record('petri', '皿', { connectProgress: 1, day: 10, compositeScore: 0.5, massKg: 1, areaM2: 100 });
    expect(s.list()[0]!.bestConnectDay).toBe(10); // 短縮したので更新する
  });

  it('スコアが下がっても上書きされない (ベストのみ保持)', () => {
    const s = new Scoreboard();
    s.record('petri', '皿', { connectProgress: 0, day: 1, compositeScore: 0.8, massKg: 5, areaM2: 500 });
    const v1 = s.version;
    s.record('petri', '皿', { connectProgress: 0, day: 2, compositeScore: 0.2, massKg: 1, areaM2: 100 });
    expect(s.version).toBe(v1);
    const rec = s.list()[0]!;
    expect(rec.bestScore).toBe(0.8);
    expect(rec.bestMassKg).toBe(5);
    expect(rec.bestAreaM2).toBe(500);
  });

  it('ステージごとに独立して記録される', () => {
    const s = new Scoreboard();
    s.record('petri', '皿', { connectProgress: 0, day: 1, compositeScore: 0.3, massKg: 1, areaM2: 100 });
    s.record('desert', '砂漠', { connectProgress: 0, day: 1, compositeScore: 0.6, massKg: 2, areaM2: 200 });
    expect(s.stagesPlayedCount()).toBe(2);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const s1 = new Scoreboard();
    s1.record('cave', '洞窟', { connectProgress: 1, day: 8, compositeScore: 0.7, massKg: 3, areaM2: 400 });
    const s2 = new Scoreboard();
    expect(s2.list()).toHaveLength(1);
    expect(s2.list()[0]!.bestConnectDay).toBe(8);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const s = new Scoreboard();
      s.record('petri', '皿', { connectProgress: 0, day: 1, compositeScore: 0.1, massKg: 1, areaM2: 1 });
    }).not.toThrow();
  });
});
