import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS, hasSeenOnboarding, markOnboardingSeen,
  hasSeenWildlandSuggestion, markWildlandSuggestionSeen, shouldSuggestWildland,
} from '../src/onboarding.js';

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

// M32: 「皿 (チュートリアル) → 原野 (本編)」の推奨動線コーチマーク。
describe('shouldSuggestWildland (M32)', () => {
  it('皿で成熟期に到達し、まだ案内していないなら true', () => {
    expect(shouldSuggestWildland('petri', '成熟期', false)).toBe(true);
  });

  it('既に案内済みなら false', () => {
    expect(shouldSuggestWildland('petri', '成熟期', true)).toBe(false);
  });

  it('皿以外のステージでは (成熟期でも) 出さない', () => {
    expect(shouldSuggestWildland('continent', '成熟期', false)).toBe(false);
    expect(shouldSuggestWildland('wildland', '成熟期', false)).toBe(false);
  });

  it('成熟期に達していなければ出さない', () => {
    expect(shouldSuggestWildland('petri', '拡散期', false)).toBe(false);
    expect(shouldSuggestWildland('petri', '胞子期', false)).toBe(false);
  });
});

describe('hasSeenWildlandSuggestion / markWildlandSuggestionSeen', () => {
  it('未確認のストレージでは false、mark 後は true (onboarding とは別キー)', () => {
    const storage = mockStorage();
    expect(hasSeenWildlandSuggestion(storage)).toBe(false);
    expect(hasSeenOnboarding(storage)).toBe(false); // 別ストレージキーで独立
    markWildlandSuggestionSeen(storage);
    expect(hasSeenWildlandSuggestion(storage)).toBe(true);
    expect(hasSeenOnboarding(storage)).toBe(false); // mark しても他方は変わらない
  });
});
