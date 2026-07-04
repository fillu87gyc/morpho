import { describe, it, expect, vi } from 'vitest';
import { Timeline } from '../src/timeline.js';

// makeThumb は M8 P3 以降 Promise<string> を返す (renderThumbnail の非同期化に
// 合わせたもの)。maybeCapture 自体は fire-and-forget なので、結果を観測する
// テストは `await Promise.resolve()` でマイクロタスクを1つ流してから読む。
async function flush(): Promise<void> {
  await Promise.resolve();
}

describe('Timeline', () => {
  it('Day 1 と 5 の倍数のときだけサムネイルを採る', async () => {
    const timeline = new Timeline();
    const makeThumb = vi.fn(async () => 'data:thumb');

    for (let day = 0; day <= 12; day++) timeline.maybeCapture(day, makeThumb);
    await flush();

    expect(timeline.list().map((e) => e.day)).toEqual([1, 5, 10]);
    expect(makeThumb).toHaveBeenCalledTimes(3);
  });

  it('同じ day には二度と採らない (同フレーム中に何度呼ばれても)', async () => {
    const timeline = new Timeline();
    const makeThumb = vi.fn(async () => 'data:thumb');

    timeline.maybeCapture(5, makeThumb);
    timeline.maybeCapture(5, makeThumb);
    timeline.maybeCapture(5, makeThumb);
    await flush();

    expect(timeline.list().length).toBe(1);
    expect(makeThumb).toHaveBeenCalledTimes(1);
  });

  it('Day 0 では採らない', async () => {
    const timeline = new Timeline();
    timeline.maybeCapture(0, async () => 'data:thumb');
    await flush();
    expect(timeline.list().length).toBe(0);
  });

  it('reset するとエントリと既採取セットの両方がクリアされる (day 1 を再度採れる)', async () => {
    const timeline = new Timeline();
    timeline.maybeCapture(1, async () => 'data:a');
    await flush();
    timeline.reset();
    expect(timeline.list().length).toBe(0);

    timeline.maybeCapture(1, async () => 'data:b');
    await flush();
    expect(timeline.list()).toEqual([{ day: 1, thumb: 'data:b' }]);
  });

  it('採取順を保持する', async () => {
    const timeline = new Timeline();
    timeline.maybeCapture(1, async () => 'a');
    timeline.maybeCapture(5, async () => 'b');
    timeline.maybeCapture(10, async () => 'c');
    await flush();
    expect(timeline.list().map((e) => e.thumb)).toEqual(['a', 'b', 'c']);
  });

  it('撮影完了より先に reset() されたら、古い世代の結果は捨てられる', async () => {
    const timeline = new Timeline();
    let resolveThumb: ((v: string) => void) | null = null;
    timeline.maybeCapture(1, () => new Promise<string>((resolve) => { resolveThumb = resolve; }));

    timeline.reset(); // まだ makeThumb が解決していないうちにリセットされる
    resolveThumb!('data:late');
    await flush();

    expect(timeline.list().length).toBe(0);
  });
});
