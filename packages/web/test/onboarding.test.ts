import { describe, it, expect } from 'vitest';
import { ONBOARDING_STEPS, hasSeenOnboarding, markOnboardingSeen } from '../src/onboarding.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function mockStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
  };
}

describe('onboarding', () => {
  it('3ステップ (環境を整える→委ねる→変化を観察する) を提示する', () => {
    expect(ONBOARDING_STEPS).toHaveLength(3);
    for (const s of ONBOARDING_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
  });

  it('未確認のストレージでは hasSeenOnboarding が false', () => {
    expect(hasSeenOnboarding(mockStorage())).toBe(false);
  });

  it('markOnboardingSeen 後は hasSeenOnboarding が true', () => {
    const storage = mockStorage();
    expect(hasSeenOnboarding(storage)).toBe(false);
    markOnboardingSeen(storage);
    expect(hasSeenOnboarding(storage)).toBe(true);
  });
});
