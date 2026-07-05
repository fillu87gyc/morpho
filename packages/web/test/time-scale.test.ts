import { describe, it, expect } from 'vitest';
import { resolveDayMs, DEFAULT_DAY_MS } from '../src/time-scale.js';

describe('resolveDayMs', () => {
  it('URL パラメータも localStorage もなければ既定値', () => {
    expect(resolveDayMs('', null)).toBe(DEFAULT_DAY_MS);
  });

  it('URL パラメータ ?dayms= があればそれを使う', () => {
    expect(resolveDayMs('?dayms=500', null)).toBe(500);
  });

  it('localStorage の値があればそれを使う (URL パラメータがない場合)', () => {
    expect(resolveDayMs('', '1234')).toBe(1234);
  });

  it('URL パラメータが localStorage より優先される', () => {
    expect(resolveDayMs('?dayms=500', '1234')).toBe(500);
  });

  it('不正な値 (0以下・非数値) は無視して既定値へフォールバックする', () => {
    expect(resolveDayMs('?dayms=0', null)).toBe(DEFAULT_DAY_MS);
    expect(resolveDayMs('?dayms=-5', null)).toBe(DEFAULT_DAY_MS);
    expect(resolveDayMs('?dayms=abc', null)).toBe(DEFAULT_DAY_MS);
    expect(resolveDayMs('', 'not-a-number')).toBe(DEFAULT_DAY_MS);
  });

  it('無効な URL パラメータは無視して localStorage にフォールバックする', () => {
    expect(resolveDayMs('?dayms=abc', '777')).toBe(777);
  });
});
