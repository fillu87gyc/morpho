// エントリ。ゲームとレンダラを生成し、RAF ループに繋ぐ。

import type { Tool } from './game.js';
import { GameProxy } from './game-proxy.js';
import { CanvasRenderer } from './render.js';
import { Ui } from './ui.js';
import { Timeline } from './timeline.js';
import { Camera } from './camera.js';
import { Minimap } from './minimap.js';
import { Encyclopedia, TOTAL_TYPE_COUNT } from './encyclopedia.js';
import { Achievements } from './achievements.js';
import { dailyChallengeFor, DailyChallengeTracker } from './challenges.js';
import { Scoreboard } from './scoreboard.js';
import { Lineage, HARVEST_MIN_DAY } from './lineage.js';
import { PinchTracker } from './pinch.js';
import { PerfHud, debugModeEnabled } from './perf-hud.js';
import { Album } from './album.js';
import { Ambient } from './ambient.js';
import { DayReport } from './day-report.js';
import { createDayLoop, beginObserve, completeDay, advanceToNextDay, TICKS_PER_DAY } from './day-loop.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
if (!canvas) throw new Error('#canvas not found');

const encyclopedia = new Encyclopedia();
const achievements = new Achievements();
const challenges = new DailyChallengeTracker();
const scoreboard = new Scoreboard();
const lineage = new Lineage();
const album = new Album();
const ambient = new Ambient();
const dayReport = new DayReport();

// 系統に採取済みの種があれば、初回起動から継承した個体で始める
// (M5: セッションをまたいで系統樹を続けられる)。
const game = new GameProxy(lineage.current()?.genome);
const renderer = new CanvasRenderer(canvas, {
  worldSize: game.worldSize,
  fieldSize: game.fieldSize,
  showHeat: false,
});
const timeline = new Timeline();
const camera = new Camera(game.worldSize);
const perfHud = new PerfHud(debugModeEnabled());

// M6: ミニマップ。クリックした場所のコロニーへズームして「個体ビュー」に切り替える。
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement | null;
if (!minimapCanvas) throw new Error('#minimap not found');
const minimap = new Minimap(minimapCanvas, game.worldSize);
minimapCanvas.addEventListener('click', (e) => {
  const rect = minimapCanvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (minimapCanvas.width / rect.width);
  const py = (e.clientY - rect.top) * (minimapCanvas.height / rect.height);
  camera.focusOn(minimap.toWorld(px, py));
});

const ui = new Ui(game, { encyclopedia, achievements, challenges, scoreboard, lineage, album }, {
  onSpeed: (s) => {
    if (s > 0) lastPositiveSpeed = s;
    game.setSpeed(s);
  },
  onTool: (t) => game.setTool(t),
  onBrush: (r) => game.setBrush(r),
  onReset: () => {
    game.reset(undefined, undefined, lineage.current()?.genome);
    timeline.reset();
    camera.reset();
    fitCanvas();
    dayReport.reset();
    if (dayLoopMode) enterPrepare(0);
  },
  onToggleHeat: () => {
    showHeat = !showHeat;
    renderer.setShowHeat(showHeat);
    document.getElementById('toggle-heat')?.classList.toggle('active', showHeat);
  },
  onResetView: () => camera.reset(),
  onStageChange: (id) => {
    game.reset(undefined, id, lineage.current()?.genome);
    timeline.reset();
    camera.reset();
    fitCanvas();
    ambient.setStage(id);
    dayReport.reset();
    if (dayLoopMode) enterPrepare(0);
  },
  onToggleAmbient: () => {
    void ambient.setEnabled(!ambient.enabled);
    const btn = document.getElementById('toggle-ambient');
    btn?.classList.toggle('active', ambient.enabled);
    if (btn) btn.textContent = ambient.enabled ? '🔊 環境音' : '🔈 環境音';
  },
  onHarvestSeed: () => {
    const snap = game.snapshot();
    if (snap.day < HARVEST_MIN_DAY) return;
    lineage.harvest({
      genome: snap.genome,
      typeId: snap.typeInfo.id,
      typeLabel: snap.typeInfo.label,
      individuality: snap.individuality,
      seed: snap.state.seed,
      day: snap.day,
      stageId: snap.stage.id,
      stageName: snap.stage.name,
    });
  },
  onScreenshot: () => {
    const snap = game.snapshot();
    // toBlob は非同期 (メインスレッドをブロックしない)。画面に見えている
    // 通りの絵 (カメラのズーム/パン込み) をそのまま撮る。
    canvas.toBlob((blob) => {
      if (blob) album.add(blob, { day: snap.day, stageName: snap.stage.name });
    }, 'image/png');
  },
  onToggleFastForward: () => {
    game.setFastForward(!game.fastForward);
    document.getElementById('fast-forward')?.classList.toggle('active', game.fastForward);
  },
});

let showHeat = false;

// ── M9: デイループ (仕込む→委ねる→受け取る) ──────────────
// 既存の「見守り (連続再生)」を既定のまま残し (継続的な DAY 自動進行を
// 前提にした e2e/smoke.spec.ts・mobile.spec.ts を壊さないため)、デイループは
// ヘッダのトグルから選ぶ第2のモードとして追加する。選択は localStorage に
// 保存し、次回起動時も同じモードで始まる。
const DAY_LOOP_MODE_KEY = 'morpho.dayLoopMode.v1';
function loadDayLoopMode(): boolean {
  try { return localStorage.getItem(DAY_LOOP_MODE_KEY) === '1'; } catch { return false; }
}
function saveDayLoopMode(v: boolean): void {
  try { localStorage.setItem(DAY_LOOP_MODE_KEY, v ? '1' : '0'); } catch { /* private mode 等は諦める */ }
}

let dayLoopMode = loadDayLoopMode();
let dayLoop = createDayLoop(0);
let lastPositiveSpeed = 1;
let dayResultThumb: string | null = null;

const dayLoopModeBtn = document.getElementById('day-loop-mode-toggle') as HTMLButtonElement;
const dayLoopBar = document.getElementById('day-loop-bar') as HTMLElement;
const beginObserveBtn = document.getElementById('begin-observe') as HTMLButtonElement;
const dayLoopRemainingEl = document.getElementById('day-loop-remaining') as HTMLElement;
const dayLoopRemainingN = document.getElementById('day-loop-remaining-n') as HTMLElement;
const dayResultModal = document.getElementById('day-result-modal') as HTMLElement;
const drDay = document.getElementById('dr-day') as HTMLElement;
const drThumb = document.getElementById('dr-thumb') as HTMLImageElement;
const drNextBtn = document.getElementById('dr-next') as HTMLButtonElement;
const drAlbumBtn = document.getElementById('dr-album') as HTMLButtonElement;
const drEvents = document.getElementById('dr-events') as HTMLElement;
const speedSliderEl = document.getElementById('speed-slider') as HTMLInputElement;
const pauseToggleEl = document.getElementById('pause-toggle') as HTMLButtonElement;
const fastForwardEl = document.getElementById('fast-forward') as HTMLButtonElement;

type TraitAxis = 'exploration' | 'efficiency' | 'stability';
const DR_AXES: { axis: TraitAxis; valId: string; deltaId: string }[] = [
  { axis: 'exploration', valId: 'dr-exploration-n', deltaId: 'dr-exploration-delta' },
  { axis: 'efficiency', valId: 'dr-efficiency-n', deltaId: 'dr-efficiency-delta' },
  { axis: 'stability', valId: 'dr-stability-n', deltaId: 'dr-stability-delta' },
];

function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// prepare フェーズ中は「仕込む」以外の操作 (速度変更/一時停止/早送り) を
// 無効化する。observe 中は通常通り操作でき、その速さがそのまま
// 「1日を消化する速さ」になる。
function setPlaybackControlsEnabled(enabled: boolean): void {
  speedSliderEl.disabled = !enabled;
  pauseToggleEl.disabled = !enabled;
  fastForwardEl.disabled = !enabled;
}

function enterPrepare(startTick: number): void {
  dayLoop = createDayLoop(startTick);
  game.setSpeed(0);
  game.runUntilTick(null);
  beginObserveBtn.hidden = false;
  dayLoopRemainingEl.hidden = true;
  dayResultModal.hidden = true;
  setPlaybackControlsEnabled(false);
}

function applyDayLoopModeUI(): void {
  dayLoopBar.hidden = !dayLoopMode;
  dayLoopModeBtn.textContent = dayLoopMode ? '🔁 デイループ' : '🔁 見守り';
  dayLoopModeBtn.classList.toggle('active', dayLoopMode);
  setPlaybackControlsEnabled(!dayLoopMode || dayLoop.phase === 'observe');
}
applyDayLoopModeUI();
if (dayLoopMode) enterPrepare(0);

dayLoopModeBtn.addEventListener('click', () => {
  dayLoopMode = !dayLoopMode;
  saveDayLoopMode(dayLoopMode);
  if (dayLoopMode) {
    enterPrepare(game.ready ? game.snapshot().state.tick : 0);
  } else {
    game.runUntilTick(null);
    game.setSpeed(lastPositiveSpeed);
    dayResultModal.hidden = true;
  }
  applyDayLoopModeUI();
});

beginObserveBtn.addEventListener('click', () => {
  if (dayLoop.phase !== 'prepare') return;
  dayLoop = beginObserve(dayLoop);
  beginObserveBtn.hidden = true;
  dayLoopRemainingEl.hidden = false;
  setPlaybackControlsEnabled(true);
  game.setSpeed(lastPositiveSpeed);
  game.runUntilTick(dayLoop.targetTick);
});

drNextBtn.addEventListener('click', () => {
  if (dayLoop.phase !== 'result') return;
  enterPrepare(dayLoop.targetTick);
});

drAlbumBtn.addEventListener('click', () => {
  const snap = game.snapshot();
  canvas!.toBlob((blob) => {
    if (blob) album.add(blob, { day: dayLoop.day, stageName: snap.stage.name });
  }, 'image/png');
});

function showDayResult(day: number): void {
  const snap = game.snapshot();
  dayReport.record({ day, traits: snap.traits, massKg: snap.world.massKg, areaM2: snap.world.areaM2 });
  const delta = dayReport.delta(day);

  drDay.textContent = String(day);
  for (const { axis, valId, deltaId } of DR_AXES) {
    const valEl = document.getElementById(valId)!;
    const deltaEl = document.getElementById(deltaId)!;
    valEl.textContent = `${Math.round(snap.traits[axis] * 100)}%`;
    const dv = delta ? delta[axis] : 0;
    if (delta && Math.abs(dv) >= 0.005) {
      deltaEl.textContent = `${dv > 0 ? '▲' : '▼'} ${Math.abs(Math.round(dv * 100))}%`;
      deltaEl.className = `dr-delta ${dv > 0 ? 'up' : 'down'}`;
    } else {
      deltaEl.textContent = delta ? '±0%' : '';
      deltaEl.className = 'dr-delta';
    }
  }

  drEvents.innerHTML = '';
  const todaysEvo = game.evolution().filter((e) => Math.floor(e.tick / TICKS_PER_DAY) === day);
  const shown = todaysEvo.length > 0 ? todaysEvo : [{ tick: day * TICKS_PER_DAY, text: '静かな一日だった…' }];
  for (const e of shown) {
    const li = document.createElement('li');
    li.textContent = e.text;
    drEvents.appendChild(li);
  }

  if (dayResultThumb) { URL.revokeObjectURL(dayResultThumb); dayResultThumb = null; }
  void renderer.renderThumbnail(snap.state, game.env, game.bio, snap.stage.id, snap.landmarks, 200).then((url) => {
    dayResultThumb = url;
    drThumb.src = url;
  });

  dayLoopRemainingEl.hidden = true;
  setPlaybackControlsEnabled(false);
  dayResultModal.hidden = false;
}

// ── 入力: カーソル位置と押下状態 ──────────────────────
// マウス: 左ボタン (ドラッグ含む) はツールの適用、右ボタンのドラッグはパン、
// ホイールはカーソル中心のズームに使う。
// タッチ: 1本指はタップ/ドラッグでツール適用 (マウス左ボタンと同じ)、
// 2本指はピンチズーム + パン (PinchTracker に委譲)。
let pressed = false;
let panning = false;
let panLast: { x: number; y: number } | null = null;
let lastApplyMs = 0;
let hover: { x: number; y: number } | null = null;
const APPLY_INTERVAL = 33; // ドラッグ中 ~30Hz で塗り続ける

const activeTouches = new Map<number, { x: number; y: number }>();
let pinch: { ids: [number, number]; tracker: PinchTracker } | null = null;

// 2本指ピンチの1本目として置かれてしまわないよう、1本指タップの確定を
// 少しだけ遅らせる (実機では2本の指は同時ではなく数msずれて触れる。
// 1本目の pointerdown で即ツールを置くと、その直後に2本目が来て
// ピンチへ切り替わっても既に置いてしまった1回分は取り消せない)。
// 遅延中に2本目が来ればタップは破棄されピンチへ、指を離せば即確定する。
const TAP_GRACE_MS = 120;
let tapTimer: ReturnType<typeof setTimeout> | null = null;
let tapPointerId: number | null = null;

function clearPendingTap(): void {
  if (tapTimer !== null) clearTimeout(tapTimer);
  tapTimer = null;
  tapPointerId = null;
}

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
  canvas.setPointerCapture(e.pointerId);
  const p = getCanvasPos(e);

  if (e.pointerType === 'touch') {
    activeTouches.set(e.pointerId, p);
    if (activeTouches.size === 2) {
      // 2本指そろった: ピンチ/パン開始。保留中のタップ (1本指分) は破棄する。
      clearPendingTap();
      pressed = false;
      const ids = [...activeTouches.keys()] as [number, number];
      const a = activeTouches.get(ids[0])!;
      const b = activeTouches.get(ids[1])!;
      pinch = { ids, tracker: new PinchTracker(a, b) };
      return;
    }
    if (activeTouches.size > 2) return; // 3本指以降は無視
    tapPointerId = e.pointerId;
    tapTimer = setTimeout(() => {
      tapTimer = null;
      if (tapPointerId !== e.pointerId) return;
      const cur = activeTouches.get(e.pointerId);
      if (!cur) return;
      pressed = true;
      applyAt(cur.x, cur.y);
    }, TAP_GRACE_MS);
    return;
  }

  if (e.button === 2) {
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  pressed = true;
  applyAt(p.x, p.y);
});
canvas.addEventListener('pointermove', (e) => {
  const p = getCanvasPos(e);
  hover = p;

  if (e.pointerType === 'touch' && activeTouches.has(e.pointerId)) {
    activeTouches.set(e.pointerId, p);
    if (pinch && (e.pointerId === pinch.ids[0] || e.pointerId === pinch.ids[1])) {
      const a = activeTouches.get(pinch.ids[0])!;
      const b = activeTouches.get(pinch.ids[1])!;
      const d = pinch.tracker.update(a, b);
      camera.zoomAt(viewportSize(), d.midpoint.x, d.midpoint.y, d.factor);
      camera.pan(viewportSize(), d.dx, d.dy);
      return;
    }
  }

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
function endTouch(e: PointerEvent): void {
  const lastPos = activeTouches.get(e.pointerId);
  const wasPendingTap = tapPointerId === e.pointerId && tapTimer !== null;
  activeTouches.delete(e.pointerId);
  if (pinch && (e.pointerId === pinch.ids[0] || e.pointerId === pinch.ids[1])) {
    // 指を1本上げた時点でピンチ/タップどちらも終了とする
    // (残り1本での再開時に誤ってツールが置かれるのを防ぐ)。
    pinch = null;
    pressed = false;
  }
  if (wasPendingTap) {
    // 2本目が来ないまま指が離れた = 素早いタップと確定。猶予を待たず即配置する。
    clearPendingTap();
    if (lastPos) applyAt(lastPos.x, lastPos.y);
  }
  pressed = false;
}
canvas.addEventListener('pointerup', (e) => {
  canvas.releasePointerCapture(e.pointerId);
  if (e.pointerType === 'touch') { endTouch(e); hover = null; return; }
  if (e.button === 2) { panning = false; panLast = null; return; }
  pressed = false;
});
canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch') {
    if (tapPointerId === e.pointerId) clearPendingTap(); // キャンセル扱いなのでタップは確定させない
    activeTouches.delete(e.pointerId);
    if (pinch && (e.pointerId === pinch.ids[0] || e.pointerId === pinch.ids[1])) pinch = null;
  }
  pressed = false;
  panning = false;
  panLast = null;
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
//
// M8 P4: 早送りモード中は、描画と HUD/実績/記録などの派生更新をまとめて
// 10fps (100ms 間隔) に間引く。浮いた分の CPU 時間は sim-worker.ts 側の
// tick スケジューラに回るので (ループ間隔と予算をそちらでも同時に
// 100ms へ切り替えている)、体感の速度が上がる。
const FAST_FORWARD_FRAME_INTERVAL_MS = 100;
let lastHeavyFrameMs = 0;

function frame() {
  perfHud.frame();
  if (game.ready) {
    // M9: 日境界への到達は消費型フラグなので、間引かれる可能性のある
    // 「重い」フレーム処理より前に、間引かれない全フレームで拾う。
    if (dayLoopMode && dayLoop.phase === 'observe' && game.consumeDayCompleted()) {
      dayLoop = completeDay(dayLoop);
      showDayResult(dayLoop.day);
    }
    const nowMs0 = performance.now();
    if (game.fastForward && nowMs0 - lastHeavyFrameMs < FAST_FORWARD_FRAME_INTERVAL_MS) {
      requestAnimationFrame(frame);
      return;
    }
    lastHeavyFrameMs = nowMs0;
    const drawT0 = performance.now();
    const size = viewportSize();
    const zoomedScale = size * camera.zoom / game.worldSize;
    const hoverPx = hover ? {
      x: hover.x,
      y: hover.y,
      radius: game.brushRadius * zoomedScale,
      tool: game.tool as Tool,
    } : undefined;
    const snap = game.snapshot();
    renderer.draw(snap.state, game.env, game.bio, snap.stage.id, snap.landmarks, camera.view(), hoverPx);
    minimap.draw(snap.colonyMarkers, camera.view());

    // M9: 観察中の残り時間 = (targetTick - tick) / 実効tick毎秒。
    if (dayLoopMode && dayLoop.phase === 'observe') {
      const perf = game.perf();
      const ticksPerSecond = perf.effectiveSpeed * (1000 / 16);
      const remainingTicks = dayLoop.targetTick - snap.state.tick;
      dayLoopRemainingN.textContent = ticksPerSecond > 0 ? formatMMSS(remainingTicks / ticksPerSecond) : '--:--';
    }
    // 育ちが浅いうち (Day 3 未満) は個性が定まっていないので図鑑には記録しない。
    if (snap.day >= 3) {
      encyclopedia.record(snap.typeInfo.id, snap.typeInfo.label, snap.genome, snap.individuality, snap.state.seed, snap.day);
    }

    const connectProgress = snap.quests.find((q) => q.id === 'connect-all')?.progress ?? 0;

    scoreboard.record(snap.stage.id, snap.stage.name, {
      connectProgress,
      day: snap.day,
      compositeScore: (snap.traits.exploration + snap.traits.efficiency + snap.traits.stability) / 3,
      massKg: snap.world.massKg,
      areaM2: snap.world.areaM2,
    });

    const today = new Date();
    const todaysChallenge = dailyChallengeFor(today);
    if (!challenges.isCompletedToday(today) && todaysChallenge.isComplete({
      connectProgress, day: snap.day, networkLinks: snap.world.networkLinks, toxin: snap.balance.toxin,
    })) {
      challenges.complete(today, todaysChallenge.kind, snap.day, snap.state.seed);
    }

    achievements.check({
      connectProgress,
      individuality: snap.individuality,
      thickEdges: snap.thickEdges,
      encyclopediaCount: encyclopedia.list().length,
      encyclopediaTotal: TOTAL_TYPE_COUNT,
      stagesPlayed: scoreboard.stagesPlayedCount(),
      dailyChallengesCompleted: challenges.completedCount(),
    }, snap.state.seed, snap.day);

    ui.render();
    timeline.maybeCapture(snap.day, () => renderer.renderThumbnail(snap.state, snap.env, snap.bio, snap.stage.id, snap.landmarks, 96));
    renderTimeline();

    const perf = game.perf();
    perfHud.render({ drawMs: performance.now() - drawT0, tickMs: perf.tickMs, targetSpeed: perf.targetSpeed, effectiveSpeed: perf.effectiveSpeed });
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
