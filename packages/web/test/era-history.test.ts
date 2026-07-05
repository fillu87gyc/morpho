import { describe, it, expect, beforeEach } from 'vitest';
import { EraHistory } from '../src/era-history.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function mockStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
  };
}

function setGlobalStorage(s: StorageLike): void {
  (globalThis as unknown as { localStorage: StorageLike }).localStorage = s;
}

describe('EraHistory', () => {
  beforeEach(() => setGlobalStorage(mockStorage()));

  it('record() で時代と日数を記録する', () => {
    const h = new EraHistory();
    h.record('胞子期', 0);
    h.record('拡散期', 8);
    expect(h.list()).toEqual([{ era: '胞子期', day: 0 }, { era: '拡散期', day: 8 }]);
  });

  it('同じ時代を連続で record しても重複追加しない (冪等)', () => {
    const h = new EraHistory();
    h.record('胞子期', 0);
    h.record('胞子期', 3);
    h.record('胞子期', 5);
    expect(h.list().length).toBe(1);
  });

  it('localStorage に永続化され、新しいインスタンスからも読める', () => {
    const h1 = new EraHistory();
    h1.record('胞子期', 0);
    h1.record('拡散期', 8);
    const h2 = new EraHistory();
    expect(h2.list()).toEqual([{ era: '胞子期', day: 0 }, { era: '拡散期', day: 8 }]);
  });

  it('reset() で空になる', () => {
    const h = new EraHistory();
    h.record('胞子期', 0);
    h.reset();
    expect(h.list()).toEqual([]);
  });
});
