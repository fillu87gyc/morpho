// M8 P0: 計測基盤の一部。
// `?debug` クエリ付きで起動したときだけ、tick コスト / 描画コスト / FPS /
// 実効速度倍率を画面隅にオーバーレイ表示する。
// 「スライダーの×24が実際には出ていない」を普段のプレイからも見えるようにする。

export interface PerfFrameInfo {
  drawMs: number;
  tickMs: number;
  targetSpeed: number;
  effectiveSpeed: number;
  // M28-B: 原野の俯瞰レイヤー (タイル + 骨格線) に使った時間。draw の内訳
  // (予算 3ms/frame の実測用)。俯瞰が出ていないフレームでは 0。
  overviewMs?: number;
  // M29: 実効ペース「日/分」(直近の実測、Worker 側で計測)。長時間セッション
  // での劣化 (「×24 なのに実際は何日/分か」) を絶対値で読むための行。
  daysPerMin?: number;
  // M29: 休眠の観測値。休眠が動いていないステージではどちらも 0 (行を出さない)。
  dormantCells?: number;
  evictedChunks?: number;
}

export class PerfHud {
  private el: HTMLElement | null = null;
  private frameTimestamps: number[] = [];

  constructor(private readonly enabled: boolean) {
    if (!enabled) return;
    const el = document.createElement('div');
    el.id = 'perf-hud';
    document.body.appendChild(el);
    this.el = el;
  }

  // requestAnimationFrame の頻度そのものから直近 1 秒の FPS を数える。
  frame(): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.frameTimestamps.push(now);
    const cutoff = now - 1000;
    while (this.frameTimestamps.length > 0 && this.frameTimestamps[0]! < cutoff) {
      this.frameTimestamps.shift();
    }
  }

  render(info: PerfFrameInfo): void {
    if (!this.enabled || !this.el) return;
    const fps = this.frameTimestamps.length;
    this.el.textContent =
      `FPS ${fps}\n` +
      `draw ${info.drawMs.toFixed(2)}ms\n` +
      (info.overviewMs !== undefined && info.overviewMs > 0 ? `ov ${info.overviewMs.toFixed(2)}ms\n` : '') +
      `tick ${info.tickMs.toFixed(2)}ms\n` +
      `speed x${info.effectiveSpeed.toFixed(1)} / x${info.targetSpeed}` +
      (info.daysPerMin !== undefined ? `\npace ${info.daysPerMin.toFixed(2)} 日/分` : '') +
      (info.dormantCells || info.evictedChunks
        ? `\ndormant ${info.dormantCells ?? 0} cells / evict ${info.evictedChunks ?? 0}`
        : '');
  }
}

export function debugModeEnabled(): boolean {
  return new URLSearchParams(location.search).has('debug');
}
