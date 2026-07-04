// M8 P0: 計測基盤の一部。
// `?debug` クエリ付きで起動したときだけ、tick コスト / 描画コスト / FPS /
// 実効速度倍率を画面隅にオーバーレイ表示する。
// 「スライダーの×24が実際には出ていない」を普段のプレイからも見えるようにする。

export interface PerfFrameInfo {
  drawMs: number;
  tickMs: number;
  targetSpeed: number;
  effectiveSpeed: number;
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
      `tick ${info.tickMs.toFixed(2)}ms\n` +
      `speed x${info.effectiveSpeed.toFixed(1)} / x${info.targetSpeed}`;
  }
}

export function debugModeEnabled(): boolean {
  return new URLSearchParams(location.search).has('debug');
}
