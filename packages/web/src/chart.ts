// M17: 統計グラフ。依存ライブラリなしの canvas 折れ線チャート。
//
// buildChartLayout() は DOM/Canvas に依存しない純粋関数 (目盛り・折れ線の
// 座標列を計算するだけ) にし、vitest で固定する。drawChart() はその
// レイアウトを実際に canvas へ描くだけの薄い関数 (テスト対象外)。
// M18 の探索レポートもこのモジュールを「汎用の系列チャート」として再利用する
// (ラベル・色・軸数をオプション化してあるのはそのため)。

export interface ChartSeries {
  label: string;
  color: string;
  values: readonly number[]; // records と同じ長さ、右軸を使うかは axis で指定
  axis: 'left' | 'right'; // left: [0,1] 固定 (探索性/効率性/安定性), right: 自動スケール (質量)
}

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartLayout {
  width: number;
  height: number;
  seriesPaths: { label: string; color: string; points: ChartPoint[] }[];
  xLabels: { x: number; text: string }[];
  leftAxisLabels: { y: number; text: string }[];
  rightAxisLabels: { y: number; text: string }[];
}

const PADDING = { top: 12, right: 40, bottom: 24, left: 34 };

// days: 各レコードに対応するラベル用の日数 (例: DayRecord.day)。
// series の values はすべて days と同じ長さである前提。
export function buildChartLayout(
  days: readonly number[],
  series: readonly ChartSeries[],
  width: number,
  height: number,
): ChartLayout {
  const innerW = Math.max(1, width - PADDING.left - PADDING.right);
  const innerH = Math.max(1, height - PADDING.top - PADDING.bottom);
  const n = days.length;

  const rightValues = series.filter((s) => s.axis === 'right').flatMap((s) => s.values);
  const rightMax = Math.max(1e-6, ...rightValues, 0);

  const xAt = (i: number): number => n <= 1 ? PADDING.left : PADDING.left + (innerW * i) / (n - 1);

  const seriesPaths = series.map((s) => ({
    label: s.label,
    color: s.color,
    points: s.values.map((v, i) => {
      const norm = s.axis === 'left' ? Math.max(0, Math.min(1, v)) : v / rightMax;
      const y = PADDING.top + innerH * (1 - Math.max(0, Math.min(1, norm)));
      return { x: xAt(i), y };
    }),
  }));

  // x軸ラベル: 最大5点程度に間引く (詰まりすぎないように)。
  const xLabelStep = Math.max(1, Math.ceil(n / 5));
  const xLabels = days
    .map((d, i) => ({ x: xAt(i), text: `Day ${d}` }))
    .filter((_, i) => i % xLabelStep === 0 || i === n - 1);

  const leftAxisLabels = [0, 0.5, 1].map((t) => ({
    y: PADDING.top + innerH * (1 - t),
    text: `${Math.round(t * 100)}%`,
  }));
  const rightAxisLabels = [0, 0.5, 1].map((t) => ({
    y: PADDING.top + innerH * (1 - t),
    text: `${(rightMax * t).toFixed(1)}kg`,
  }));

  return { width, height, seriesPaths, xLabels, leftAxisLabels, rightAxisLabels };
}

export function drawChart(ctx: CanvasRenderingContext2D, layout: ChartLayout): void {
  const { width, height } = layout;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0, 0, width, height);

  // 目盛り線 (左軸基準)
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (const l of layout.leftAxisLabels) {
    ctx.beginPath();
    ctx.moveTo(PADDING.left, l.y);
    ctx.lineTo(width - PADDING.right, l.y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(l.text, PADDING.left - 4, l.y + 3);
  }
  for (const l of layout.rightAxisLabels) {
    ctx.fillStyle = 'rgba(232,184,75,0.7)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(l.text, width - PADDING.right + 4, l.y + 3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.textAlign = 'center';
  for (const l of layout.xLabels) {
    ctx.fillText(l.text, l.x, height - PADDING.bottom + 14);
  }

  for (const s of layout.seriesPaths) {
    if (s.points.length === 0) continue;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  }
}
