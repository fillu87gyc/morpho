import { describe, it, expect } from 'vitest';
import { createDayLoop, beginObserve, completeDay, advanceToNextDay, TICKS_PER_DAY } from '../src/day-loop.js';

describe('day-loop', () => {
  it('tick 0 から作ると Day 0 の prepare で始まり、targetTick は1日ぶん先', () => {
    const s = createDayLoop(0);
    expect(s).toEqual({ phase: 'prepare', day: 0, targetTick: TICKS_PER_DAY });
  });

  it('途中の tick から作ると、その日の prepare として復元する', () => {
    const s = createDayLoop(TICKS_PER_DAY * 3 + 5);
    expect(s.phase).toBe('prepare');
    expect(s.day).toBe(3);
    expect(s.targetTick).toBe(TICKS_PER_DAY * 4);
  });

  it('prepare → observe → result → 次の日の prepare、と1周する', () => {
    let s = createDayLoop(0);
    s = beginObserve(s);
    expect(s.phase).toBe('observe');

    s = completeDay(s);
    expect(s.phase).toBe('result');
    expect(s.day).toBe(0);

    s = advanceToNextDay(s);
    expect(s).toEqual({ phase: 'prepare', day: 1, targetTick: TICKS_PER_DAY * 2 });
  });

  it('不正な遷移は無視され、状態は変わらない (何度呼んでも安全)', () => {
    let s = createDayLoop(0);
    expect(completeDay(s)).toBe(s); // prepare で completeDay は無効
    expect(advanceToNextDay(s)).toBe(s); // prepare で advanceToNextDay は無効

    s = beginObserve(s);
    expect(beginObserve(s)).toBe(s); // observe で beginObserve は無効
    expect(advanceToNextDay(s)).toBe(s); // observe で advanceToNextDay は無効

    s = completeDay(s);
    expect(beginObserve(s)).toBe(s); // result で beginObserve は無効
    expect(completeDay(s)).toBe(s); // result で completeDay は無効
  });
});
