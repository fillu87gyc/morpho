// エントリ。ゲームとレンダラを生成し、RAF ループに繋ぐ。

import type { Tool } from './game.js';
import { GameProxy } from './game-proxy.js';
import { CanvasRenderer } from './render.js';
import { Ui } from './ui.js';
import { Timeline } from './timeline.js';
import { Camera } from './camera.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#canvas not found');

const game = new GameProxy();
const renderer = new CanvasRenderer(canvas, {
  worldSize: game.worldSize,
  fieldSize: game.fieldSize,
  showHeat: false,
});
const timeline = new Timeline();
const camera = new Camera(game.worldSize);

const ui = new Ui(game, {
  onSpeed: (s) => game.setSpeed(s),
  onTool: (t) => game.setTool(t),
  onBrush: (r) => game.setBrush(r),
  onReset: () => {
    game.reset();
    timeline.reset();
    camera.reset();
    fitCanvas();
  },
  onToggleHeat: () => {
    showHeat = !showHeat;
    renderer.setShowHeat(showHeat);
    document.getElementById('toggle-heat')?.classList.toggle('active', showHeat);
  },
  onResetView: () => camera.reset(),
});

let showHeat = false;

// ── 入力: カーソル位置と押下状態 ──────────────────────
// 左ボタン (ドラッグ含む) はツールの適用、右ボタンのドラッグはパン、
// ホイールはカーソル中心のズームに使う。
let pressed = false;
let panning = false;
let panLast: { x: number; y: number } | null = null;
let lastApplyMs = 0;
let hover: { x: number; y: number } | null = null;
const APPLY_INTERVAL = 33; // ドラッグ中 ~30Hz で塗り続ける

function getCanvasPos(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function viewportSize(): number {
  const rect = canvas!.getBoundingClientRect();
  return Math.min(rect.width, rect.height);
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  if (e.button === 2) {
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0) return;
  pressed = true;
  canvas.setPointerCapture(e.pointerId);
  const p = getCanvasPos(e);
  applyAt(p.x, p.y);
});
canvas.addEventListener('pointermove', (e) => {
  hover = getCanvasPos(e);
  if (panning && panLast) {
    const dx = e.clientX - panLast.x;
    const dy = e.clientY - panLast.y;
    panLast = { x: e.clientX, y: e.clientY };
    camera.pan(viewportSize(), dx, dy);
    return;
  }
  if (pressed && performance.now() - lastApplyMs > APPLY_INTERVAL) {
    applyAt(hover.x, hover.y);
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (e.button === 2) { panning = false; panLast = null; canvas.releasePointerCapture(e.pointerId); return; }
  pressed = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointerleave', () => { hover = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = getCanvasPos(e);
  // 上スクロール (deltaY < 0) でズームイン。指数的に効かせて滑らかにする。
  const factor = Math.pow(1.0015, -e.deltaY);
  camera.zoomAt(viewportSize(), p.x, p.y, factor);
}, { passive: false });
canvas.addEventListener('dblclick', () => camera.reset());

function applyAt(x: number, y: number): void {
  const worldPos = camera.screenToWorld(viewportSize(), x, y);
  game.apply(worldPos);
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
    const size = viewportSize();
    const zoomedScale = size * camera.zoom / game.worldSize;
    const hoverPx = hover ? {
      x: hover.x,
      y: hover.y,
      radius: game.brushRadius * zoomedScale,
      tool: game.tool as Tool,
    } : undefined;
    renderer.draw(game.snapshot().state, game.env, game.bio, camera.view(), hoverPx);
    ui.render();
    const snap = game.snapshot();
    timeline.maybeCapture(snap.day, () => renderer.renderThumbnail(snap.state, snap.env, snap.bio, 96));
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
