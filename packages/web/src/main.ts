// エントリ。ゲームとレンダラを生成し、RAF ループに繋ぐ。

import type { Tool } from './game.js';
import { GameProxy } from './game-proxy.js';
import { CanvasRenderer } from './render.js';
import { Ui } from './ui.js';
import { Timeline } from './timeline.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#canvas not found');

const game = new GameProxy();
const renderer = new CanvasRenderer(canvas, {
  worldSize: game.worldSize,
  fieldSize: game.fieldSize,
  showHeat: false,
});
const timeline = new Timeline();

const ui = new Ui(game, {
  onSpeed: (s) => game.setSpeed(s),
  onTool: (t) => game.setTool(t),
  onBrush: (r) => game.setBrush(r),
  onReset: () => {
    game.reset();
    timeline.reset();
    fitCanvas();
  },
  onToggleHeat: () => {
    showHeat = !showHeat;
    renderer.setShowHeat(showHeat);
    document.getElementById('toggle-heat')?.classList.toggle('active', showHeat);
  },
});

let showHeat = false;

// ── 入力: カーソル位置と押下状態 ──────────────────────
let pressed = false;
let lastApplyMs = 0;
let hover: { x: number; y: number } | null = null;
const APPLY_INTERVAL = 33; // ドラッグ中 ~30Hz で塗り続ける

function getCanvasPos(e: PointerEvent): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

canvas.addEventListener('pointerdown', (e) => {
  pressed = true;
  canvas.setPointerCapture(e.pointerId);
  const p = getCanvasPos(e);
  applyAt(p.x, p.y);
});
canvas.addEventListener('pointermove', (e) => {
  hover = getCanvasPos(e);
  if (pressed && performance.now() - lastApplyMs > APPLY_INTERVAL) {
    applyAt(hover.x, hover.y);
  }
});
canvas.addEventListener('pointerup', (e) => {
  pressed = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointerleave', () => { hover = null; });

function applyAt(x: number, y: number): void {
  const rect = canvas!.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  game.apply(x, y, size);
  lastApplyMs = performance.now();
}

// ── レイアウト ────────────────────────────────────────
function fitCanvas(): void {
  const wrap = canvas!.parentElement as HTMLElement;
  const r = wrap.getBoundingClientRect();
  const size = Math.floor(Math.min(r.width, r.height));
  canvas!.style.width = `${size}px`;
  canvas!.style.height = `${size}px`;
  renderer.resize();
}
window.addEventListener('resize', fitCanvas);
fitCanvas();

// ── メインループ ─────────────────────────────────────
// tick は sim-worker.ts が自前のタイマーで進める。ここでは Worker から
// 届いた最新スナップショットを描画するだけ (UI 操作は tick の重さに
// 影響されない)。
function frame() {
  if (game.ready) {
    const rect = canvas!.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const hoverPx = hover ? {
      x: hover.x,
      y: hover.y,
      radius: game.brushRadius * (size / game.worldSize),
      tool: game.tool as Tool,
    } : undefined;
    renderer.draw(game.snapshot().state, game.env, game.bio, hoverPx);
    ui.render();
    timeline.maybeCapture(game.snapshot().day, () => renderer.captureThumbnail(96));
    renderTimeline();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ── 成長タイムライン ──────────────────────────────────
const timelineEl = document.getElementById('timeline');
let lastTimelineLen = -1;
function renderTimeline(): void {
  if (!timelineEl) return;
  const entries = timeline.list();
  if (entries.length === lastTimelineLen) return;
  lastTimelineLen = entries.length;
  timelineEl.innerHTML = '';
  for (const e of entries) {
    const fig = document.createElement('figure');
    fig.className = 'timeline-entry';
    const img = document.createElement('img');
    img.src = e.thumb;
    img.alt = `Day ${e.day}`;
    const cap = document.createElement('figcaption');
    cap.textContent = `Day ${e.day}`;
    fig.appendChild(img);
    fig.appendChild(cap);
    timelineEl.appendChild(fig);
  }
  timelineEl.scrollLeft = timelineEl.scrollWidth;
}
