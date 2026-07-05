import { describe, it, expect, beforeEach } from 'vitest';
import { Notes, summaryText } from '../src/notes.js';

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

describe('Notes', () => {
  beforeEach(() => setGlobalStorage(mockStorage()));

  it('add() でメモが先頭に追加される', () => {
    const n = new Notes();
    n.add(1, '最初のメモ');
    n.add(2, '次のメモ');
    expect(n.list()[0]?.text).toBe('次のメモ');
    expect(n.list()[1]?.text).toBe('最初のメモ');
  });

  it('空文字/空白のみは追加しない', () => {
    const n = new Notes();
    n.add(1, '   ');
    n.add(1, '');
    expect(n.list()).toEqual([]);
  });

  it('前後の空白はトリムされる', () => {
    const n = new Notes();
    n.add(1, '  こんにちは  ');
    expect(n.list()[0]?.text).toBe('こんにちは');
  });

  it('remove() で指定した id のメモだけ消える', () => {
    const n = new Notes();
    n.add(1, 'a');
    n.add(2, 'b');
    const idToRemove = n.list().find((x) => x.text === 'a')!.id;
    n.remove(idToRemove);
    expect(n.list().map((x) => x.text)).toEqual(['b']);
  });

  it('version は追加/削除のたびに増える', () => {
    const n = new Notes();
    const v0 = n.version;
    n.add(1, 'a');
    expect(n.version).toBeGreaterThan(v0);
    const v1 = n.version;
    n.remove(n.list()[0]!.id);
    expect(n.version).toBeGreaterThan(v1);
  });

  it('localStorage に永続化され、新しいインスタンスからも読める', () => {
    const n1 = new Notes();
    n1.add(3, '永続化テスト');
    const n2 = new Notes();
    expect(n2.list()[0]?.text).toBe('永続化テスト');
  });
});

describe('summaryText', () => {
  it('日数とスコア・質量を含む定型文を作る', () => {
    const text = summaryText(5, 0.7, 0.5, 0.3, 1.234);
    expect(text).toContain('Day 5');
    expect(text).toContain('70%');
    expect(text).toContain('50%');
    expect(text).toContain('30%');
    expect(text).toContain('1.23kg');
  });
});
