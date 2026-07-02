import { describe, it, expect, vi } from 'vitest';
import { Timeline } from '../src/timeline.js';

describe('Timeline', () => {
  it('Day 1 と 5 の倍数のときだけサムネイルを採る', () => {
    const timeline = new Timeline();
    const makeThumb = vi.fn(() => 'data:thumb');

    for (let day = 0; day <= 12; day++) timeline.maybeCapture(day, makeThumb);

    expect(timeline.list().map((e) => e.day)).toEqual([1, 5, 10]);
    expect(makeThumb).toHaveBeenCalledTimes(3);
  });

  it('同じ day には二度と採らない (同フレーム中に何度呼ばれても)', () => {
    const timeline = new Timeline();
    const makeThumb = vi.fn(() => 'data:thumb');

    timeline.maybeCapture(5, makeThumb);
    timeline.maybeCapture(5, makeThumb);
    timeline.maybeCapture(5, makeThumb);

    expect(timeline.list().length).toBe(1);
    expect(makeThumb).toHaveBeenCalledTimes(1);
  });

  it('Day 0 では採らない', () => {
    const timeline = new Timeline();
    timeline.maybeCapture(0, () => 'data:thumb');
    expect(timeline.list().length).toBe(0);
  });

  it('reset するとエントリと既採取セットの両方がクリアされる (day 1 を再度採れる)', () => {
    const timeline = new Timeline();
    timeline.maybeCapture(1, () => 'data:a');
    timeline.reset();
    expect(timeline.list().length).toBe(0);

    timeline.maybeCapture(1, () => 'data:b');
    expect(timeline.list()).toEqual([{ day: 1, thumb: 'data:b' }]);
  });

  it('採取順を保持する', () => {
    const timeline = new Timeline();
    timeline.maybeCapture(1, () => 'a');
    timeline.maybeCapture(5, () => 'b');
    timeline.maybeCapture(10, () => 'c');
    expect(timeline.list().map((e) => e.thumb)).toEqual(['a', 'b', 'c']);
  });
});
