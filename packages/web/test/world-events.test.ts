import { describe, it, expect } from 'vitest';
import { WorldEventLog, filterByArea, type WorldEvent } from '../src/world-events.js';

describe('WorldEventLog', () => {
  it('push した順に unshift され、最新が先頭に来る', () => {
    const log = new WorldEventLog(30);
    log.push({ day: 0, tick: 0, kind: 'a', text: '最初' });
    log.push({ day: 0, tick: 1, kind: 'b', text: '次' });
    expect(log.all()[0]?.text).toBe('次');
    expect(log.all()[1]?.text).toBe('最初');
  });

  it('id は単調増加する', () => {
    const log = new WorldEventLog(30);
    log.push({ day: 0, tick: 0, kind: 'a', text: 'x' });
    log.push({ day: 0, tick: 1, kind: 'a', text: 'y' });
    log.push({ day: 0, tick: 2, kind: 'a', text: 'z' });
    const ids = log.all().map((e) => e.id);
    expect(ids).toEqual([2, 1, 0]);
  });

  it('上限を超えると古いものから捨てる', () => {
    const log = new WorldEventLog(3);
    for (let i = 0; i < 5; i++) log.push({ day: 0, tick: i, kind: 'a', text: `e${i}` });
    expect(log.all().length).toBe(3);
    expect(log.all().map((e) => e.text)).toEqual(['e4', 'e3', 'e2']);
  });

  it('上限到達後も latestId は変化し続ける (length だけでは検知できない更新)', () => {
    const log = new WorldEventLog(2);
    log.push({ day: 0, tick: 0, kind: 'a', text: 'a' });
    log.push({ day: 0, tick: 1, kind: 'a', text: 'b' });
    const lenBefore = log.all().length;
    const idBefore = log.latestId;
    log.push({ day: 0, tick: 2, kind: 'a', text: 'c' });
    expect(log.all().length).toBe(lenBefore);
    expect(log.latestId).not.toBe(idBefore);
  });

  it('reset() で空になり id も0から振り直される', () => {
    const log = new WorldEventLog(30);
    log.push({ day: 0, tick: 0, kind: 'a', text: 'x' });
    log.reset();
    expect(log.all()).toEqual([]);
    log.push({ day: 0, tick: 0, kind: 'a', text: 'y' });
    expect(log.all()[0]?.id).toBe(0);
  });
});

describe('filterByArea', () => {
  const view = { worldLeft: 10, worldTop: 10, worldSpan: 20 }; // covers [10,30]x[10,30]

  function evt(overrides: Partial<WorldEvent>): WorldEvent {
    return { id: 0, day: 0, tick: 0, kind: 'a', text: 't', ...overrides };
  }

  it('座標を持つ出来事は視野内のものだけ残す', () => {
    const events = [
      evt({ id: 1, x: 15, y: 15 }), // 内側
      evt({ id: 2, x: 50, y: 50 }), // 外側
    ];
    const filtered = filterByArea(events, view);
    expect(filtered.map((e) => e.id)).toEqual([1]);
  });

  it('座標を持たない出来事は常に通す', () => {
    const events = [evt({ id: 1 }), evt({ id: 2, x: 999, y: 999 })];
    const filtered = filterByArea(events, view);
    expect(filtered.map((e) => e.id)).toEqual([1]);
  });

  it('境界ちょうど (視野の縁) は含む', () => {
    const events = [evt({ id: 1, x: 10, y: 10 }), evt({ id: 2, x: 30, y: 30 })];
    const filtered = filterByArea(events, view);
    expect(filtered.map((e) => e.id)).toEqual([1, 2]);
  });
});
