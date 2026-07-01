// エントリ。ゲームとレンダラを生成し、RAF ループに繋ぐ。

import { Game, type Tool } from './game.js';
import { CanvasRenderer } from './render.js';
import { Ui } from './ui.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#canvas not found');

const game = new Game();
const renderer = new CanvasRenderer(canvas, {
  worldSize: game.worldSize,
  fieldSize: game.fieldSize,
  showHeat: false,
});

const ui = new Ui(game, {
  onSpeed: (s) => game.setSpeed(s),
  onTool: (t) => game.setTool(t),
  onBrush: (r) => game.setBrush(r),
  onReset: () => {
    game.reset();
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
  if (game.tool === 'stone') game.pushEvent('障害物を置いた');
  else if (game.tool === 'food') game.pushEvent('栄養を撒いた');
  else if (game.tool === 'water') game.pushEvent('水を引いた');
  else if (game.tool === 'light') game.pushEvent('光をあてた');
  else if (game.tool === 'erase') game.pushEvent('土地をならした');
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
function frame() {
  game.tick();
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
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
