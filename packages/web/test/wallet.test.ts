import { describe, it, expect, beforeEach } from 'vitest';
import { Wallet, TOOL_COSTS } from '../src/wallet.js';

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

describe('Wallet', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('初期残高を持つ (詰み防止のため十分な量から始まる)', () => {
    const w = new Wallet();
    expect(w.get('sizuku')).toBeGreaterThan(0);
    expect(w.get('wakaba')).toBeGreaterThan(0);
    expect(w.get('horoishi')).toBe(0);
  });

  it('コストのないツール (light/erase) は常に afford できる', () => {
    const w = new Wallet();
    expect(w.canAfford('light')).toBe(true);
    expect(w.canAfford('erase')).toBe(true);
    expect(w.costOf('light')).toBeNull();
  });

  it('コストのあるツールは残高から正しい通貨を引く', () => {
    const w = new Wallet();
    const before = w.get('sizuku');
    const ok = w.spendForTool('food');
    expect(ok).toBe(true);
    expect(w.get('sizuku')).toBe(before - TOOL_COSTS.food!.amount);
  });

  it('残高不足のツールは canAfford が false になり、spendForTool は失敗して残高を変えない', () => {
    const w = new Wallet();
    for (let i = 0; i < 100; i++) w.spendForTool('toxin'); // wakaba を使い切る
    expect(w.get('wakaba')).toBeLessThan(TOOL_COSTS.toxin!.amount);
    expect(w.canAfford('toxin')).toBe(false);
    const before = w.get('wakaba');
    expect(w.spendForTool('toxin')).toBe(false);
    expect(w.get('wakaba')).toBe(before);
  });

  it('earn() は残高を増やし、履歴に記録される', () => {
    const w = new Wallet();
    const before = w.get('wakaba');
    w.earn('wakaba', 5, 'テスト報酬');
    expect(w.get('wakaba')).toBe(before + 5);
    expect(w.historyList().at(-1)?.reason).toBe('テスト報酬');
    expect(w.historyList().at(-1)?.delta).toBe(5);
  });

  it('履歴は直近 50 件を超えると古いものから捨てられる', () => {
    const w = new Wallet();
    for (let i = 0; i < 60; i++) w.earn('wakaba', 1, `entry-${i}`);
    expect(w.historyList().length).toBe(50);
    expect(w.historyList()[0]?.reason).toBe('entry-10');
  });

  it('🪙 が下限を割っていると、間隔を空けて呼ぶたびに下限まで回復する', () => {
    const w = new Wallet(0);
    for (let i = 0; i < 100; i++) w.spendForTool('food'); // sizuku を大きく減らす
    expect(w.get('sizuku')).toBeLessThan(20);
    const before = w.get('sizuku');

    w.tickRecovery(1000); // まだ間隔未満: 変化しない
    expect(w.get('sizuku')).toBe(before);

    w.tickRecovery(5000); // 4000ms 経過: 1回復
    expect(w.get('sizuku')).toBe(before + 1);
  });

  it('🪙 が下限以上のときは自動回復しない', () => {
    const w = new Wallet(0);
    const before = w.get('sizuku');
    expect(before).toBeGreaterThanOrEqual(20);
    w.tickRecovery(100000);
    expect(w.get('sizuku')).toBe(before);
  });

  it('自動回復は下限を超えては積み上がらない', () => {
    const w = new Wallet(0);
    for (let i = 0; i < 100; i++) w.spendForTool('food');
    let t = 0;
    for (let i = 0; i < 200; i++) { t += 4000; w.tickRecovery(t); }
    expect(w.get('sizuku')).toBe(20);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const w1 = new Wallet();
    w1.earn('horoishi', 2, 'テスト');
    const w2 = new Wallet();
    expect(w2.get('horoishi')).toBe(2);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const w = new Wallet();
      w.earn('wakaba', 1, 'x');
      w.spendForTool('food');
    }).not.toThrow();
  });
});
