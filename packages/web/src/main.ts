// エントリ。ゲームとレンダラを生成し、RAF ループに繋ぐ。

import type { Tool } from './game.js';
import { GameProxy } from './game-proxy.js';
import { CanvasRenderer } from './render.js';
import { Ui } from './ui.js';
import { Timeline } from './timeline.js';
import { Camera } from './camera.js';
import { Minimap } from './minimap.js';
import { Encyclopedia, TOTAL_TYPE_COUNT } from './encyclopedia.js';
import { Achievements, ACHIEVEMENT_DEFS } from './achievements.js';
import { allChallenges, DailyChallengeTracker } from './challenges.js';
import { Scoreboard } from './scoreboard.js';
import { Lineage, HARVEST_MIN_DAY } from './lineage.js';
import { PinchTracker } from './pinch.js';
import { PerfHud, debugModeEnabled } from './perf-hud.js';
import { Album } from './album.js';
import { Ambient } from './ambient.js';
import { DayReport } from './day-report.js';
import { createDayLoop, beginObserve, completeDay, advanceToNextDay, TICKS_PER_DAY, formatMMSS } from './day-loop.js';
import { Wallet, type CurrencyKind } from './wallet.js';
import { DailyTracker } from './dailies.js';
import { Identity } from './identity.js';
import { starsOf, traitChipsFor, environmentTagsFor } from './trait-labels.js';
import { CatalogueThumbs } from './catalogue-thumbs.js';
import { LineageThumbs } from './lineage-thumbs.js';
import { allCatalogueEntries, type CatalogueContext } from './catalogue.js';
import { localTimeFor, nightFactorFor } from './daytime.js';
import { ONBOARDING_STEPS, hasSeenOnboarding, markOnboardingSeen } from './onboarding.js';
import { detectMutation, detectNewTraitChips, newTraitChipText } from './mutation-events.js';
import type { EvolutionLog } from './game.js';
import { buildChartLayout, drawChart, type ChartSeries } from './chart.js';
import { EraHistory } from './era-history.js';
import { Notes } from './notes.js';
import { buildReport, eraHistoryLines } from './report.js';
import { setWorldOverview } from './world-overview.js';

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
const eraHistory = new EraHistory();
// M17: 突然変異・形質獲得イベント。sim には手を入れず、日境界で前日と当日の
// DayRecord.traits / traitChipsFor() を比較した web 側派生として「進化の記録」
// に流し込む (game.ts の evoLog/eraLog とは別に main.ts 側で保持し、
// ui.render() で合流させる)。
const MAX_LOCAL_EVO = 30;
let localEvoLog: EvolutionLog[] = [];
function pushLocalEvo(tick: number, text: string): void {
  localEvoLog.unshift({ tick, text });
  if (localEvoLog.length > MAX_LOCAL_EVO) localEvoLog.pop();
}
// 日境界で dayReport.record() の直後に呼ぶ。前日の記録がなければ何もしない
// (初日は比較対象がない)。
function checkMutationEvents(day: number): void {
  const prev = dayReport.of(day - 1);
  const cur = dayReport.of(day);
  if (!prev || !cur) return;
  const snap = game.snapshot();
  const mutationText = detectMutation(prev.traits, cur.traits);
  if (mutationText) pushLocalEvo(snap.state.tick, mutationText);
  const newChips = detectNewTraitChips(snap.genome, prev.traits, cur.traits, snap.typeInfo.label);
  const chipText = newTraitChipText(newChips);
  if (chipText) pushLocalEvo(snap.state.tick, chipText);
}
const wallet = new Wallet();
const dailies = new DailyTracker();
const identity = new Identity();
const catalogueThumbs = new CatalogueThumbs();
const notes = new Notes();
const lineageThumbs = new LineageThumbs();
let undoUsedCount = 0;
// M12: 「個体を追跡する」。ミニマップクリックで対象コロニーを選び、
// トグルで追従の on/off を切り替える。手動ズーム/パンで解除する。
let trackedColonyIndex: number | null = null;
let tracking = false;

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
  const worldPos = minimap.toWorld(px, py);
  // M12: クリックした場所に一番近いコロニーを「追跡対象」として選ぶ。
  if (game.ready) {
    const markers = game.snapshot().colonyMarkers;
    let nearest = -1, bestD2 = Infinity;
    markers.forEach((m, i) => {
      const d2 = (m.pos.x - worldPos.x) ** 2 + (m.pos.y - worldPos.y) ** 2;
      if (d2 < bestD2) { bestD2 = d2; nearest = i; }
    });
    if (nearest >= 0) trackedColonyIndex = nearest;
  }
  camera.focusOn(worldPos);
});

const ui = new Ui(game, { encyclopedia, achievements, challenges, scoreboard, lineage, album, catalogueThumbs, notes, lineageThumbs }, {
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
    eraHistory.reset();
    localEvoLog = [];
    identity.advance();
    tracking = false;
    trackedColonyIndex = null;
    lastEraName = '胞子期';
    lastWatchedDay = -1;
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
    eraHistory.reset();
    localEvoLog = [];
    identity.advance();
    tracking = false;
    trackedColonyIndex = null;
    lastEraName = '胞子期';
    lastWatchedDay = -1;
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
    const entry = lineage.harvest({
      genome: snap.genome,
      typeId: snap.typeInfo.id,
      typeLabel: snap.typeInfo.label,
      individuality: snap.individuality,
      seed: snap.state.seed,
      day: snap.day,
      stageId: snap.stage.id,
      stageName: snap.stage.name,
    });
    // M18: 系統樹ノードのサムネイル。採種時点の姿を撮り IndexedDB へ保存する
    // (renderThumbnail() は blob URL の Promise を返すため、生の Blob が
    // 要る IndexedDB 保存には fetch() で取り出す — catalogue-thumbs と同じ経路)。
    void renderer.renderThumbnail(snap.state, game.env, game.bio, snap.stage.id, snap.landmarks, 160)
      .then((url) => {
        if (!url) return null;
        return fetch(url).then((r) => r.blob()).finally(() => URL.revokeObjectURL(url));
      })
      .then((blob) => { if (blob) void lineageThumbs.set(entry.id, blob); });
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
  // M13: 系統樹の任意の祖先から「この子から始める」。選び直した祖先の
  // genome を継承した新しい個体でその場から再開する。
  onStartFromLineage: (id) => {
    const ancestor = lineage.startFrom(id);
    if (!ancestor) return;
    game.reset(undefined, ancestor.stageId, ancestor.genome);
    timeline.reset();
    camera.reset();
    fitCanvas();
    dayReport.reset();
    eraHistory.reset();
    localEvoLog = [];
    identity.advance();
    tracking = false;
    trackedColonyIndex = null;
    lastEraName = '胞子期';
    lastWatchedDay = -1;
    if (dayLoopMode) enterPrepare(0);
  },
});

let showHeat = false;
// M14: 時代が切り替わった節目で 🍄 を1度だけ贈る。game.ts の reset() 既定
// ('胞子期') と揃え、ステージ/系統樹からの再開時も明示的に揃え直す。
let lastEraName = '胞子期';
// M15.5: 見守りモードでは (デイループの result 遷移がないため) DayRecord が
// 一切積まれず、デイループへ切り替えた初日の結果パネルに前日比Δが出ない
// 問題があった。見守り中も日境界 (snap.day の増分) を検知して記録する。
let lastWatchedDay = -1;

// ── M10: 「やり直す」(Undo) ────────────────────────────
const undoBtn = document.getElementById('undo-stroke') as HTMLButtonElement;
undoBtn.addEventListener('click', () => { game.undoStroke(); undoUsedCount++; });
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    game.undoStroke();
    undoUsedCount++;
  }
});

// ── M15: モバイル縦画面のハンバーガー (パネル類のドロワー開閉) ──────────
const menuToggleBtn = document.getElementById('menu-toggle') as HTMLButtonElement;
menuToggleBtn.addEventListener('click', () => {
  document.body.classList.toggle('drawer-open');
});

// ── M15: 初回オンボーディング (3ステップのコーチマーク) ────────────────
const onboardingEl = document.getElementById('onboarding') as HTMLElement;
const onboardingTitleEl = document.getElementById('onboarding-title') as HTMLElement;
const onboardingBodyEl = document.getElementById('onboarding-body') as HTMLElement;
const onboardingStepNEl = document.getElementById('onboarding-step-n') as HTMLElement;
const onboardingNextBtn = document.getElementById('onboarding-next') as HTMLButtonElement;
const onboardingSkipBtn = document.getElementById('onboarding-skip') as HTMLButtonElement;
let onboardingStepIndex = 0;

function renderOnboardingStep(): void {
  const step = ONBOARDING_STEPS[onboardingStepIndex];
  if (!step) return;
  onboardingTitleEl.textContent = step.title;
  onboardingBodyEl.textContent = step.body;
  onboardingStepNEl.textContent = `${onboardingStepIndex + 1}/${ONBOARDING_STEPS.length}`;
  onboardingNextBtn.textContent = onboardingStepIndex === ONBOARDING_STEPS.length - 1 ? 'はじめる ▶' : '次へ ▶';
}

function closeOnboarding(): void {
  onboardingEl.hidden = true;
  markOnboardingSeen();
  maybeShowDayLoopChoice();
}

onboardingNextBtn.addEventListener('click', () => {
  if (onboardingStepIndex >= ONBOARDING_STEPS.length - 1) {
    closeOnboarding();
    return;
  }
  onboardingStepIndex++;
  renderOnboardingStep();
});
onboardingSkipBtn.addEventListener('click', () => closeOnboarding());

if (!hasSeenOnboarding()) {
  onboardingEl.hidden = false;
  renderOnboardingStep();
}

// ── M17: 統計グラフ ────────────────────────────────────
// dayReport (直近60日) の3軸スコア + 質量 (右軸) を canvas 折れ線チャートで見せる。
// buildChartLayout は chart.ts の純粋関数、描画はここで一度だけ (モーダルを
// 開いたとき / 開いている間に新しい日が記録されたときだけ) 行えば十分。
const chartModalEl = document.getElementById('chart-modal') as HTMLElement;
const chartCanvasEl = document.getElementById('chart-canvas') as HTMLCanvasElement;
const chartEmptyEl = document.getElementById('chart-empty') as HTMLElement;
const chartOpenBtn = document.getElementById('chart-open') as HTMLButtonElement;
const chartCloseBtn = document.getElementById('chart-close') as HTMLButtonElement;

function renderChart(): void {
  const records = dayReport.list();
  if (records.length < 2) {
    chartCanvasEl.hidden = true;
    chartEmptyEl.hidden = false;
    return;
  }
  chartCanvasEl.hidden = false;
  chartEmptyEl.hidden = true;
  const days = records.map((r) => r.day);
  const series: ChartSeries[] = [
    { label: '探索性', color: '#8fd0ff', values: records.map((r) => r.traits.exploration), axis: 'left' },
    { label: '効率性', color: '#ffd27a', values: records.map((r) => r.traits.efficiency), axis: 'left' },
    { label: '安定性', color: '#9dffa0', values: records.map((r) => r.traits.stability), axis: 'left' },
    { label: '質量', color: '#e8b84b', values: records.map((r) => r.massKg), axis: 'right' },
  ];
  const layout = buildChartLayout(days, series, chartCanvasEl.width, chartCanvasEl.height);
  const ctx = chartCanvasEl.getContext('2d');
  if (ctx) drawChart(ctx, layout);
}

chartOpenBtn.addEventListener('click', () => {
  chartModalEl.hidden = false;
  renderChart();
});
chartCloseBtn.addEventListener('click', () => { chartModalEl.hidden = true; });

// ── M18: 探索レポート ──────────────────────────────────
const reportModalEl = document.getElementById('report-modal') as HTMLElement;
const reportOpenBtn = document.getElementById('report-open') as HTMLButtonElement;
const reportCloseBtn = document.getElementById('report-close') as HTMLButtonElement;
const reportSaveBtn = document.getElementById('report-save') as HTMLButtonElement;
const reportChartCanvasEl = document.getElementById('report-chart-canvas') as HTMLCanvasElement;
const reportChartEmptyEl = document.getElementById('report-chart-empty') as HTMLElement;
const reportEraHistoryEl = document.getElementById('report-era-history') as HTMLElement;

function renderReport(): void {
  const snap = game.snapshot();
  const records = dayReport.list();
  const report = buildReport({
    records,
    eraHistory: eraHistory.list(),
    connectedColonies: snap.world.coloniesReached,
    totalColonies: snap.world.coloniesTotal,
    exploration: snap.traits.exploration,
    discoveredSpecies: encyclopedia.list().length,
    totalSpecies: allCatalogueEntries().length,
    achievementsUnlocked: achievements.list().length,
    totalAchievements: ACHIEVEMENT_DEFS.length,
  });

  document.getElementById('report-colonies')!.textContent = `${report.summary.connectedColonies}/${report.summary.totalColonies}`;
  document.getElementById('report-exploration')!.textContent = `${report.summary.explorationPct}%`;
  document.getElementById('report-species')!.textContent = `${report.summary.discoveredSpecies}/${report.summary.totalSpecies}`;
  document.getElementById('report-achievements')!.textContent = `${report.summary.achievementsUnlocked}/${report.summary.totalAchievements}`;

  reportEraHistoryEl.innerHTML = '';
  const lines = eraHistoryLines(report.eraHistory);
  if (lines.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'まだ記録がない…';
    reportEraHistoryEl.appendChild(li);
  } else {
    for (const line of lines) {
      const li = document.createElement('li');
      li.textContent = line;
      reportEraHistoryEl.appendChild(li);
    }
  }

  if (records.length < 2) {
    reportChartCanvasEl.hidden = true;
    reportChartEmptyEl.hidden = false;
    return;
  }
  reportChartCanvasEl.hidden = false;
  reportChartEmptyEl.hidden = true;
  const days = records.map((r) => r.day);
  const series: ChartSeries[] = [
    { label: '面積', color: '#8fd0ff', values: records.map((r) => r.areaM2), axis: 'right' },
    { label: '質量', color: '#e8b84b', values: records.map((r) => r.massKg), axis: 'right' },
  ];
  const layout = buildChartLayout(days, series, reportChartCanvasEl.width, reportChartCanvasEl.height);
  const ctx = reportChartCanvasEl.getContext('2d');
  if (ctx) drawChart(ctx, layout);
}

reportOpenBtn.addEventListener('click', () => {
  reportModalEl.hidden = false;
  renderReport();
});
reportCloseBtn.addEventListener('click', () => { reportModalEl.hidden = true; });
reportSaveBtn.addEventListener('click', () => {
  // モーダルの card 部分を画像として合成し、既存のアルバム経路 (M7) へ保存する。
  const modalCard = reportModalEl.querySelector('.card') as HTMLElement;
  if (!modalCard) return;
  const rect = modalCard.getBoundingClientRect();
  const out = document.createElement('canvas');
  out.width = Math.round(rect.width * 2);
  out.height = Math.round(rect.height * 2);
  const octx = out.getContext('2d');
  if (!octx) return;
  octx.scale(2, 2);
  octx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel') || '#1a1a1a';
  octx.fillRect(0, 0, rect.width, rect.height);
  const chartRect = reportChartCanvasEl.getBoundingClientRect();
  if (!reportChartCanvasEl.hidden) {
    octx.drawImage(reportChartCanvasEl, chartRect.left - rect.left, chartRect.top - rect.top, chartRect.width, chartRect.height);
  }
  out.toBlob((blob) => {
    if (blob) album.add(blob, { day: game.snapshot().day, stageName: `探索レポート・${game.snapshot().stage.name}` });
  }, 'image/png');
});

// ── M11: 通貨HUD ──────────────────────────────────────
const CURRENCY_ICON: Record<CurrencyKind, string> = { sizuku: '🪙', wakaba: '🍃', horoishi: '🍄' };
const curEl: Record<CurrencyKind, HTMLElement> = {
  sizuku: document.getElementById('cur-sizuku') as HTMLElement,
  wakaba: document.getElementById('cur-wakaba') as HTMLElement,
  horoishi: document.getElementById('cur-horoishi') as HTMLElement,
};
const chipEl: Record<CurrencyKind, HTMLElement> = {
  sizuku: curEl.sizuku.closest('.wallet-chip') as HTMLElement,
  wakaba: curEl.wakaba.closest('.wallet-chip') as HTMLElement,
  horoishi: curEl.horoishi.closest('.wallet-chip') as HTMLElement,
};
const lastShownBalance: Partial<Record<CurrencyKind, number>> = {};

const toolButtons = [...document.querySelectorAll<HTMLButtonElement>('button.tool')];
for (const btn of toolButtons) {
  const tool = btn.dataset.tool ?? '';
  btn.dataset.baseTitle = btn.title;
  const cost = wallet.costOf(tool);
  if (!cost) continue;
  const badge = document.createElement('span');
  badge.className = 'tool-cost';
  badge.textContent = `${CURRENCY_ICON[cost.currency]}${cost.amount}`;
  btn.appendChild(badge);
}

// M19: 通貨増減の「+n」フロート演出。M11 の簡易フラッシュに追加する形で、
// 残高チップから差分が浮いて消える。prefers-reduced-motion では出さない。
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function spawnCurrencyFloat(currency: CurrencyKind, delta: number): void {
  if (delta === 0 || prefersReducedMotion()) return;
  const el = document.createElement('span');
  el.className = `wallet-float ${delta > 0 ? 'up' : 'down'}`;
  el.textContent = `${delta > 0 ? '+' : ''}${delta.toLocaleString('ja-JP')}`;
  chipEl[currency].appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function updateWalletUi(): void {
  const b = wallet.all();
  for (const currency of Object.keys(curEl) as CurrencyKind[]) {
    const v = b[currency];
    if (lastShownBalance[currency] === v) continue;
    if (lastShownBalance[currency] !== undefined) {
      chipEl[currency].classList.add('flash');
      setTimeout(() => chipEl[currency].classList.remove('flash'), 400);
      spawnCurrencyFloat(currency, v - lastShownBalance[currency]!);
    }
    lastShownBalance[currency] = v;
    curEl[currency].textContent = v.toLocaleString('ja-JP');
  }
  for (const btn of toolButtons) {
    const tool = btn.dataset.tool ?? '';
    const cost = wallet.costOf(tool);
    if (!cost) continue;
    const afford = wallet.canAfford(tool);
    btn.classList.toggle('unaffordable', !afford);
    btn.title = afford
      ? (btn.dataset.baseTitle ?? '')
      : `${btn.dataset.baseTitle ?? ''} (${CURRENCY_ICON[cost.currency]}${cost.amount} が足りません)`;
  }
}
updateWalletUi();

// ── M11: ゆるいデイリー UI ─────────────────────────────
const dailiesEl = document.getElementById('dailies') as HTMLElement;
let lastDailiesVersion = -1;
let lastDailiesDateKey = '';

function renderDailies(): void {
  const today = new Date();
  const key = today.toDateString();
  if (lastDailiesVersion === dailies.version && lastDailiesDateKey === key) return;
  lastDailiesVersion = dailies.version;
  lastDailiesDateKey = key;
  dailiesEl.innerHTML = '';
  for (const task of dailies.tasksToday(today)) {
    const li = document.createElement('li');
    const done = dailies.isDone(task);
    li.className = done ? 'done' : '';
    const check = document.createElement('span');
    check.className = 'check';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = task.title;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${Math.min(dailies.progressOf(task.id), task.target)}/${task.target}`;
    li.appendChild(check);
    li.appendChild(label);
    li.appendChild(n);
    dailiesEl.appendChild(li);
  }
}
renderDailies();

// ── M12: 個体の物語 (名前・★・特性チップ・追跡) ──────────
const indNameBtn = document.getElementById('ind-name') as HTMLButtonElement;
const indStarsEl = document.getElementById('ind-stars') as HTMLElement;
const indChipsEl = document.getElementById('ind-chips') as HTMLElement;
const indEnvChipsEl = document.getElementById('ind-env-chips') as HTMLElement;
const trackToggleBtn = document.getElementById('track-toggle') as HTMLButtonElement;
const localTimeEl = document.getElementById('local-time') as HTMLElement;

indNameBtn.addEventListener('click', () => {
  const next = window.prompt('この個体の名前', identity.name());
  if (next !== null) identity.rename(next);
  renderIdentity();
});

trackToggleBtn.addEventListener('click', () => {
  tracking = !tracking;
  if (tracking && trackedColonyIndex === null) trackedColonyIndex = 0;
  trackToggleBtn.classList.toggle('active', tracking);
});

function renderChips(container: HTMLElement, labels: string[]): void {
  container.innerHTML = '';
  for (const label of labels) {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = label;
    container.appendChild(span);
  }
}

function renderIdentity(): void {
  indNameBtn.textContent = identity.name();
  // tracking は手動ズーム/パン/ピンチでも false になるので、ボタンの見た目は
  // 都度ここで実際の状態に合わせ直す (どこで false にしても表示が追随する)。
  trackToggleBtn.classList.toggle('active', tracking);
  if (!game.ready) return;
  const snap = game.snapshot();
  const stars = starsOf(snap.individuality);
  indStarsEl.textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
  renderChips(indChipsEl, traitChipsFor(snap.genome, snap.traits, snap.typeInfo.label));
  renderChips(indEnvChipsEl, environmentTagsFor(snap.balance));
}
renderIdentity();

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
// M16: ⏸ ▶ ▶▶ ▶▶▶ の4段ボタン (旧スライダー+⏩トグルの置き換え)。
const speedBtnEls = ['speed-btn-pause', 'speed-btn-1', 'speed-btn-8', 'speed-btn-24']
  .map((id) => document.getElementById(id) as HTMLButtonElement);

type TraitAxis = 'exploration' | 'efficiency' | 'stability';
const DR_AXES: { axis: TraitAxis; valId: string; deltaId: string }[] = [
  { axis: 'exploration', valId: 'dr-exploration-n', deltaId: 'dr-exploration-delta' },
  { axis: 'efficiency', valId: 'dr-efficiency-n', deltaId: 'dr-efficiency-delta' },
  { axis: 'stability', valId: 'dr-stability-n', deltaId: 'dr-stability-delta' },
];

// prepare フェーズ中は「仕込む」以外の操作 (速度変更/一時停止/早送り) を
// 無効化する。observe 中は通常通り操作でき、その速さがそのまま
// 「1日を消化する速さ」になる。
function setPlaybackControlsEnabled(enabled: boolean): void {
  for (const btn of speedBtnEls) btn.disabled = !enabled;
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

// M19: オンボーディング直後の初回のみ「デイループ / 見守り」の2択を出す。
// 既存ユーザー (キーが既に設定済み = 過去にこの選択かトグル操作をしたことが
// ある) には出さず、現在の選択をそのまま維持する。
const dayLoopChoiceEl = document.getElementById('day-loop-choice') as HTMLElement;
const dayLoopChoiceWatchBtn = document.getElementById('day-loop-choice-watch') as HTMLButtonElement;
const dayLoopChoiceLoopBtn = document.getElementById('day-loop-choice-loop') as HTMLButtonElement;
function hasChosenDayLoopMode(): boolean {
  try { return localStorage.getItem(DAY_LOOP_MODE_KEY) !== null; } catch { return true; }
}
function applyDayLoopChoice(loop: boolean): void {
  dayLoopChoiceEl.hidden = true;
  dayLoopMode = loop;
  saveDayLoopMode(loop);
  applyDayLoopModeUI();
  if (loop) enterPrepare(game.ready ? game.snapshot().state.tick : 0);
}
function maybeShowDayLoopChoice(): void {
  if (hasChosenDayLoopMode()) return;
  dayLoopChoiceEl.hidden = false;
}
dayLoopChoiceWatchBtn.addEventListener('click', () => applyDayLoopChoice(false));
dayLoopChoiceLoopBtn.addEventListener('click', () => applyDayLoopChoice(true));

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
  checkMutationEvents(day);
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

  // M19 (P8): renderThumbnail() は非同期 (toBlob) なので、モーダルが開く
  // 前回の revoke で drThumb.src が「死んだ blob URL」を指したままの一瞬が
  // 壊れ画像アイコンとして見えていた。src を先に外して背景色 (.dr-thumb の
  // placeholder) に戻し、新しい URL が届いてから src を張って古い URL を
  // revoke する (順序を入れ替えて「無参照の一瞬」を作らない)。
  drThumb.removeAttribute('src');
  const previousThumb = dayResultThumb;
  dayResultThumb = null;
  void renderer.renderThumbnail(snap.state, game.env, game.bio, snap.stage.id, snap.landmarks, 200).then((url) => {
    dayResultThumb = url;
    drThumb.src = url;
    if (previousThumb) URL.revokeObjectURL(previousThumb);
  });

  // M11: 日次結果の成長量に応じて 🪙 を付与する (基本給 + 前日比が伸びたボーナス)。
  const growthBonus = delta ? Math.max(0, Math.round((delta.exploration + delta.efficiency + delta.stability) * 20)) : 0;
  wallet.earn('sizuku', 10 + growthBonus, `Day ${day} の成長`);

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
      game.beginStroke();
      applyAt(cur.x, cur.y);
    }, TAP_GRACE_MS);
    return;
  }

  if (e.button === 2) {
    panning = true;
    panLast = { x: e.clientX, y: e.clientY };
    tracking = false; // M12: 手動パンで追従解除
    return;
  }
  if (e.button !== 0) return;
  pressed = true;
  game.beginStroke();
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
      tracking = false; // M12: 手動ピンチで追従解除
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
    if (lastPos) {
      game.beginStroke();
      applyAt(lastPos.x, lastPos.y);
    }
  }
  // M10: Undo の stroke 境界。beginStroke が呼ばれていなくても
  // (2本指ピンチのみで終わった等) endStroke は no-op なので安全に呼べる。
  game.endStroke();
  pressed = false;
}
canvas.addEventListener('pointerup', (e) => {
  canvas.releasePointerCapture(e.pointerId);
  if (e.pointerType === 'touch') { endTouch(e); hover = null; return; }
  if (e.button === 2) { panning = false; panLast = null; return; }
  game.endStroke();
  pressed = false;
});
canvas.addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'touch') {
    if (tapPointerId === e.pointerId) clearPendingTap(); // キャンセル扱いなのでタップは確定させない
    activeTouches.delete(e.pointerId);
    if (pinch && (e.pointerId === pinch.ids[0] || e.pointerId === pinch.ids[1])) pinch = null;
  }
  game.endStroke();
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
  tracking = false; // M12: 手動ホイールズームで追従解除
}, { passive: false });
canvas.addEventListener('dblclick', () => camera.reset());

// M16: ズームスライダー ⇄ Camera.zoom の双方向バインド。
const zoomSliderEl = document.getElementById('zoom-slider') as HTMLInputElement;
const zoomInBtn = document.getElementById('zoom-in') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out') as HTMLButtonElement;
let zoomSliderDragging = false;
zoomSliderEl.addEventListener('pointerdown', () => { zoomSliderDragging = true; });
zoomSliderEl.addEventListener('pointerup', () => { zoomSliderDragging = false; });
zoomSliderEl.addEventListener('input', () => {
  camera.setZoomCentered(viewportSize(), Number(zoomSliderEl.value));
  tracking = false;
});
function stepZoom(delta: number): void {
  const next = Math.max(1, Math.min(8, camera.zoom + delta));
  camera.setZoomCentered(viewportSize(), next);
  zoomSliderEl.value = next.toFixed(1);
  tracking = false;
}
zoomInBtn.addEventListener('click', () => stepZoom(0.5));
zoomOutBtn.addEventListener('click', () => stepZoom(-0.5));

function applyAt(x: number, y: number): void {
  // M11: 残高不足のツールは適用しない (グレーアウト表示と対になる)。
  if (!wallet.canAfford(game.tool)) return;
  wallet.spendForTool(game.tool);
  const worldPos = camera.screenToWorld(viewportSize(), x, y);
  game.apply(worldPos);
  lastApplyMs = performance.now();

  // M11: ゆるいデイリーの配置カウント判定 (sim の状態は見ない、適用イベントのみ)。
  if (dailies.recordApply(game.tool)) {
    wallet.earn('wakaba', 5, 'ゆるいデイリー全達成');
    dailies.markBonusGranted();
  }
}

// ── レイアウト ────────────────────────────────────────
function fitCanvas(): void {
  const wrap = canvas!.parentElement as HTMLElement;
  // M15.5: <canvas> は CSS 幅が未指定だと HTML の width/height 属性 (intrinsic
  // size) がそのまま replaced element としてのサイズになり、flex/grid の
  // 自動最小サイズ計算に混ざる。measure → 設定 → 再measure が「前回設定した
  // (大きすぎる) サイズ」を基準に収束してしまい、モバイル幅では二度と
  // 縮まらない循環に陥っていた (390px 幅で document が 700px超に膨張する
  // 実プレイ検証の崩れの根本原因)。計測前に一旦 0 にして自身の footprint を
  // 消してから wrap の「本当に使える幅」を測る。
  canvas!.style.width = '0px';
  canvas!.style.height = '0px';
  const r = wrap.getBoundingClientRect();
  // モバイル縦 (≤900px) では .stage の行高がコンテンツ由来のため、canvas を
  // ゼロ化すると wrap の高さも 0 になり size=0 で固定される (キャンバスが
  // 永久に描画されない)。高さが測れないときは幅を一辺とする正方形とし、
  // 下部ツールバーを除いたビューポート残り高さでクランプする。
  const avail = window.innerHeight - r.top - 100;
  const h = r.height > 0 ? r.height : Math.min(r.width, Math.max(240, avail));
  const size = Math.floor(Math.min(r.width, h));
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
    // M11: 🪙 の詰み防止自動回復。間引かれない全フレームで呼ぶ (内部で間隔制御)。
    wallet.tickRecovery(performance.now());
    updateWalletUi();
    renderDailies();
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
    // M25: 「原野」の窓が前線を追って再センタリングされていたら、カメラも
    // 同じ量だけずらして継ぎ目に気づかれないようにする (この snap の
    // state は既に新しい窓原点で平行移動済みなので、描画より前に必ず適用する)。
    const windowShift = game.consumeWindowShift();
    if (windowShift) camera.shiftCenter(windowShift.x, windowShift.y);
    // M28: 「原野」の全世界俯瞰 (Worker から低頻度で届く) の最新値を
    // モジュール状態 (world-overview.ts) に置くだけ。絵に起こす大局レイヤー/
    // ワールドマップは M28-B が getWorldOverview() を import して読む。
    setWorldOverview(game.worldOverview());
    // M14: 時代が切り替わった節目に 🍄 を1度だけ贈る (進化の記録には
    // game.ts 側の eraLog で既に残っている、ここは通貨報酬だけを付与)。
    if (snap.era.name !== lastEraName) {
      lastEraName = snap.era.name;
      wallet.earn('horoishi', 1, `時代が「${snap.era.name}」に進んだ`);
      eraHistory.record(snap.era.name, snap.day);
    }
    // M15.5: 見守りモード中も日境界ごとに DayRecord を積む (デイループの
    // result 遷移でしか記録しないと、切替初日の結果パネルに前日比Δが出ない)。
    if (snap.day > lastWatchedDay) {
      if (!dayLoopMode && lastWatchedDay >= 0) {
        dayReport.record({ day: lastWatchedDay, traits: snap.traits, massKg: snap.world.massKg, areaM2: snap.world.areaM2 });
        checkMutationEvents(lastWatchedDay);
      }
      lastWatchedDay = snap.day;
    }
    // M12: 「個体を追跡する」— 選択コロニーの重心へ毎フレーム滑らかに寄せる。
    if (tracking && trackedColonyIndex !== null) {
      const marker = snap.colonyMarkers[trackedColonyIndex];
      if (marker) camera.panToward(marker.centroid, 0.08);
    }
    renderer.draw(snap.state, game.env, game.bio, snap.stage.id, snap.landmarks, camera.view(), hoverPx, nightFactorFor(snap.state.tick));
    // M16: ステージが変わった (リセット/切替) ときだけ再焼き (bakeTerrain 内部でも
    // 同一 stageId ならスキップするが、呼び出し自体を間引く必要はない — 判定は軽い)。
    minimap.bakeTerrain(snap.stage.id, game.env);
    minimap.draw(snap.colonyMarkers, camera.view());
    localTimeEl.textContent = localTimeFor(snap.state.tick);
    renderIdentity();
    // M16: ホイール/ピンチ/追従で camera.zoom が変わったら、ドラッグ中でない
    // 限りスライダー表示もそれに追従させる (双方向バインド)。
    if (!zoomSliderDragging && Math.abs(Number(zoomSliderEl.value) - camera.zoom) > 0.05) {
      zoomSliderEl.value = camera.zoom.toFixed(1);
    }

    // M9: 観察中の残り時間 = (targetTick - tick) / 実効tick毎秒。
    // M15.7: effectiveSpeed の単位を「倍率」から実測 ticks/秒 (絶対値) へ
    // 変更したので、ここでの換算 (旧: ×16ms 基準) は不要になった。
    if (dayLoopMode && dayLoop.phase === 'observe') {
      const perf = game.perf();
      const ticksPerSecond = perf.effectiveSpeed;
      const remainingTicks = dayLoop.targetTick - snap.state.tick;
      dayLoopRemainingN.textContent = ticksPerSecond > 0 ? formatMMSS(remainingTicks / ticksPerSecond) : '--:--';
    }
    const connectProgress = snap.quests.find((q) => q.id === 'connect-all')?.progress ?? 0;

    // 育ちが浅いうち (Day 3 未満) は個性が定まっていないので図鑑には記録しない。
    if (snap.day >= 3) {
      const catalogueCtx: CatalogueContext = {
        typeId: snap.typeInfo.id, stageId: snap.stage.id, individuality: snap.individuality,
        genome: snap.genome, balance: snap.balance, generation: lineage.nextGeneration(), connectProgress,
      };
      const newlyDiscovered = encyclopedia.record(catalogueCtx, snap.state.seed, snap.day);
      // M13: 新規発見のカタログ枠だけサムネイルを撮って保存する (毎フレーム撮り直さない)。
      // renderThumbnail() は blob URL の Promise を返す (IndexedDB には生の Blob が
      // 要るため fetch() で取り出し、一時 URL は使い終わったら解放する)。
      for (const id of newlyDiscovered) {
        void renderer.renderThumbnail(snap.state, game.env, game.bio, snap.stage.id, snap.landmarks, 160)
          .then((url) => {
            if (!url) return null;
            return fetch(url).then((r) => r.blob()).finally(() => URL.revokeObjectURL(url));
          })
          .then((blob) => { if (blob) void catalogueThumbs.set(id, blob); });
      }
    }

    scoreboard.record(snap.stage.id, snap.stage.name, {
      connectProgress,
      day: snap.day,
      compositeScore: (snap.traits.exploration + snap.traits.efficiency + snap.traits.stability) / 3,
      massKg: snap.world.massKg,
      areaM2: snap.world.areaM2,
    });

    // M11: 3種すべてを常時チェックし、初回達成のものだけ 🍃 報酬を付与する。
    for (const chal of allChallenges()) {
      if (challenges.isCompleted(chal.kind)) continue;
      if (!chal.isComplete({ connectProgress, day: snap.day, networkLinks: snap.world.networkLinks, toxin: snap.balance.toxin })) continue;
      challenges.complete(chal.kind, snap.day, snap.state.seed);
      wallet.earn('wakaba', 8, `チャレンジ「${chal.title}」達成`);
    }

    const newlyUnlocked = achievements.check({
      connectProgress,
      individuality: snap.individuality,
      thickEdges: snap.thickEdges,
      encyclopediaCount: encyclopedia.list().length,
      encyclopediaTotal: TOTAL_TYPE_COUNT,
      stagesPlayed: scoreboard.stagesPlayedCount(),
      dailyChallengesCompleted: challenges.completedCount(),
      dayRecordsCount: dayReport.list().length,
      toxin: snap.balance.toxin,
      hasFiveStarEntry: encyclopedia.list().some((e) => starsOf(e.individuality) === 5),
      walletTotal: wallet.get('sizuku') + wallet.get('wakaba') + wallet.get('horoishi'),
      undoUsedCount,
    }, snap.state.seed, snap.day);
    // M11: 実績解除は希少通貨 🍄 の報酬源。
    for (const id of newlyUnlocked) wallet.earn('horoishi', 1, `実績「${id}」解除`);

    ui.render(camera.view(), localEvoLog);
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
