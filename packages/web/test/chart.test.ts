import { describe, it, expect } from 'vitest';
import { buildChartLayout, type ChartSeries } from '../src/chart.js';

describe('buildChartLayout', () => {
  const days = [1, 2, 3];
  const series: ChartSeries[] = [
    { label: '探索性', color: '#8fd0ff', values: [0.2, 0.5, 0.8], axis: 'left' },
    { label: '質量', color: '#e8b84b', values: [1, 2, 4], axis: 'right' },
  ];

  it('各系列の点の数は日数と一致する', () => {
    const layout = buildChartLayout(days, series, 400, 200);
    for (const s of layout.seriesPaths) {
      expect(s.points.length).toBe(days.length);
    }
  });

  it('left 軸の値は [0,1] を [top,bottom] にマップする (0→下端, 1→上端)', () => {
    const layout = buildChartLayout([1, 2], [{ label: 'a', color: '#fff', values: [0, 1], axis: 'left' }], 400, 200);
    const [p0, p1] = layout.seriesPaths[0]!.points;
    expect(p0!.y).toBeGreaterThan(p1!.y); // 0 は下 (yが大きい)、1 は上 (yが小さい)
  });

  it('right 軸は最大値で正規化される (最大値の点が上端に来る)', () => {
    const layout = buildChartLayout([1, 2, 3], [{ label: 'm', color: '#fff', values: [1, 2, 4], axis: 'right' }], 400, 200);
    const pts = layout.seriesPaths[0]!.points;
    // 最大値 (4, index 2) の y が最小 (最も上)
    const minY = Math.min(...pts.map((p) => p.y));
    expect(pts[2]!.y).toBeCloseTo(minY, 5);
  });

  it('x座標は日数順に単調増加する', () => {
    const layout = buildChartLayout(days, series, 400, 200);
    const xs = layout.seriesPaths[0]!.points.map((p) => p.x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
  });

  it('日数が1件でもクラッシュしない (x は左端に固定)', () => {
    const layout = buildChartLayout([5], [{ label: 'a', color: '#fff', values: [0.5], axis: 'left' }], 400, 200);
    expect(layout.seriesPaths[0]!.points.length).toBe(1);
    expect(Number.isFinite(layout.seriesPaths[0]!.points[0]!.x)).toBe(true);
  });

  it('日数が0件でもクラッシュしない', () => {
    const layout = buildChartLayout([], [{ label: 'a', color: '#fff', values: [], axis: 'left' }], 400, 200);
    expect(layout.seriesPaths[0]!.points).toEqual([]);
  });

  it('x軸ラベルは間引かれても最後の日付は必ず含む', () => {
    const manyDays = Array.from({ length: 30 }, (_, i) => i + 1);
    const layout = buildChartLayout(manyDays, [{ label: 'a', color: '#fff', values: manyDays.map(() => 0.5), axis: 'left' }], 400, 200);
    expect(layout.xLabels.some((l) => l.text === 'Day 30')).toBe(true);
  });
});
