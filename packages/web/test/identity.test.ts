import { describe, it, expect, beforeEach } from 'vitest';
import { Identity } from '../src/identity.js';

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

describe('Identity', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('初回は #1 から始まる', () => {
    const id = new Identity();
    expect(id.currentNumber()).toBe(1);
    expect(id.name()).toBe('ねばりのこ #1');
  });

  it('advance() で通し番号が進み、リネームはリセットされる', () => {
    const id = new Identity();
    id.rename('つよいこ');
    id.advance();
    expect(id.currentNumber()).toBe(2);
    expect(id.name()).toBe('ねばりのこ #2');
  });

  it('rename() でカスタム名が使われる', () => {
    const id = new Identity();
    id.rename('つよいこ');
    expect(id.name()).toBe('つよいこ');
  });

  it('空文字にリネームすると既定の名前に戻る', () => {
    const id = new Identity();
    id.rename('つよいこ');
    id.rename('   ');
    expect(id.name()).toBe('ねばりのこ #1');
  });

  it('通し番号は世代を跨いでも増え続ける (リセットしない)', () => {
    const id = new Identity();
    for (let i = 0; i < 5; i++) id.advance();
    expect(id.currentNumber()).toBe(6);
  });

  it('localStorage に永続化され、再生成しても続きから発番できる', () => {
    const id1 = new Identity();
    id1.advance();
    id1.advance();
    const id2 = new Identity();
    expect(id2.currentNumber()).toBe(3);
    id2.advance();
    expect(id2.currentNumber()).toBe(4);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const id = new Identity();
      id.advance();
      id.rename('x');
    }).not.toThrow();
  });
});
