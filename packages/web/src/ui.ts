// HUD と入力。DOM 更新を集約。
// - 値が変わったところだけ書き換える (textContent が等しければスキップ)。
// - 数値はモックアップに合わせて千桁区切り。

import type { Tool, StageId, EvolutionLog } from './game.js';
import type { GameProxy } from './game-proxy.js';
import type { Encyclopedia } from './encyclopedia.js';
import { ACHIEVEMENT_DEFS, type Achievements } from './achievements.js';
import { allChallenges, type DailyChallengeTracker } from './challenges.js';
import type { Scoreboard } from './scoreboard.js';
import { HARVEST_MIN_DAY, type Lineage } from './lineage.js';
import type { Album } from './album.js';
import { allCatalogueEntries } from './catalogue.js';
import type { CatalogueThumbs } from './catalogue-thumbs.js';
import { starsOf, typeDescriptionFor } from './trait-labels.js';
import { estimateEraEta, type EraSample } from './era.js';
import { formatMMSS, TICKS_PER_DAY } from './day-loop.js';
import { filterByArea, type WorldEvent } from './world-events.js';
import type { WorldView } from './camera.js';
import { localTimeFor } from './daytime.js';
import { Notes, summaryText } from './notes.js';
import type { LineageThumbs } from './lineage-thumbs.js';

type El = HTMLElement;

function el(id: string): El {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e;
}

function setText(e: El, s: string): void {
  if (e.textContent !== s) e.textContent = s;
}

function setBar(e: El, ratio: number): void {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  e.style.width = `${pct.toFixed(1)}%`;
}

function pct(v: number): string { return `${Math.round(v * 100)}%`; }
function thou(n: number): string { return n.toLocaleString('ja-JP'); }

export class Ui {
  // header
  private day = el('day');
  private era = el('era');
  private eraRing = el('era-ring');
  private stageName = el('stage-name');
  // メインクエスト (固定2本) + M6 ワールド目標 (コロニー統合)
  private qConnectBar = el('q-connect-bar');
  private qConnectN = el('q-connect-n');
  private qExploreBar = el('q-explore-bar');
  private qExploreN = el('q-explore-n');
  private qUniteBar = el('q-unite-bar');
  private qUniteN = el('q-unite-n');
  // M14: 大陸ステージのみ表示するクエスト
  private qContinentItem = el('q-continent-item');
  private qContinentBar = el('q-continent-bar');
  private qContinentN = el('q-continent-n');
  // M11: チャレンジ一覧 (3種常時表示)
  private chalList = el('chal-list');
  private chalProgress = el('chal-progress');
  // world info
  private wArea = el('w-area');
  private wMass = el('w-mass');
  private wLinks = el('w-links');
  private wCr = el('w-cr');
  private wCt = el('w-ct');
  // M6: ワールドビュー (コロニー数 / 統合ネットワーク数)
  private wNetworks = el('w-networks');
  private wColonies = el('w-colonies');
  // env balance (5 axes)
  private eLight = el('e-light');
  private eTemp = el('e-temp');
  private eMoi = el('e-moisture');
  private eNut = el('e-nutrient');
  private eTox = el('e-toxin');
  private eLightN = el('e-light-n');
  private eTempN = el('e-temp-n');
  private eMoiN = el('e-moisture-n');
  private eNutN = el('e-nutrient-n');
  private eToxN = el('e-toxin-n');
  // traits
  private tExp = el('t-explore');
  private tEff = el('t-efficient');
  private tStb = el('t-stable');
  private tExpN = el('t-explore-n');
  private tEffN = el('t-efficient-n');
  private tStbN = el('t-stable-n');
  // individuality (個体ビュー)
  private tHealth = el('t-health');
  private tVitality = el('t-vitality');
  private tAdapt = el('t-adapt');
  private tHealthN = el('t-health-n');
  private tVitalityN = el('t-vitality-n');
  private tAdaptN = el('t-adapt-n');
  private indTypeN = el('ind-type-n');
  private indTypeDesc = el('ind-type-desc');
  // 図鑑
  private ency = el('ency');
  private encyProgress = el('ency-progress');
  // M18: 収集・記録タブ (図鑑/マップ/メモ)
  private recordTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.record-tab'));
  private recordPanels = Array.from(document.querySelectorAll<HTMLElement>('.record-panel'));
  private noteText = el('note-text') as HTMLTextAreaElement;
  private notesList = el('notes-list');
  // アチーブメント
  private ach = el('ach');
  private achProgress = el('ach-progress');
  // 記録
  private board = el('board');
  // 系統樹
  private lineageGen = el('lineage-gen');
  private lineageList = el('lineage');
  private harvestBtn = el('harvest-seed') as HTMLButtonElement;
  private harvestHint = el('harvest-hint');
  // アルバム
  private albumGrid = el('album');
  private albumCount = el('album-count');
  private screenshotBtn = el('screenshot') as HTMLButtonElement;
  // logs
  private log = el('log');
  private evo = el('evo');
  // M17: 「このエリアを注視中」。camera の視野内 (WorldEvent.x/y と交差) だけに
  // 絞るトグル。座標を持たない出来事は絞り込みの対象外 (常に通す)。
  private logAreaToggle = el('log-area-toggle') as HTMLButtonElement;
  private logAreaLabel = el('log-area-label');
  private areaWatch = false;
  // brush
  private brushN = el('brush-n');

  private lastEvoLen = -1;
  private lastEventFilterKey = '';
  private lastEncyVersion = -1;
  private lastAchVersion = -1;
  private lastBoardVersion = -1;
  private lastLineageVersion = '';
  private lastAlbumVersion = -1;
  private lastNotesVersion = -1;
  private lastChalKey = '';
  private lastHarvestable = false;
  private lastStageId: StageId | null = null;
  // M16: 時代の残り時間予測。progress を実時間軸でサンプリングして
  // estimateEraEta() に渡す。時代名が変わったら履歴をリセットする。
  private lastEraNameForEta: string | null = null;
  private eraSamples: EraSample[] = [];
  private lastEraSampleAtMs = 0;
  private readonly ERA_SAMPLE_INTERVAL_MS = 2500;
  private readonly ERA_SAMPLE_MAX = 20;
  private eraEtaEl = el('era-eta');

  constructor(
    private game: GameProxy,
    private trackers: {
      encyclopedia: Encyclopedia;
      achievements: Achievements;
      challenges: DailyChallengeTracker;
      scoreboard: Scoreboard;
      lineage: Lineage;
      album: Album;
      catalogueThumbs: CatalogueThumbs;
      notes: Notes;
      lineageThumbs: LineageThumbs;
    },
    private hooks: {
      onSpeed: (s: number) => void;
      onTool: (t: Tool) => void;
      onBrush: (r: number) => void;
      onReset: () => void;
      onToggleHeat: () => void;
      onResetView: () => void;
      onStageChange: (id: StageId) => void;
      onHarvestSeed: () => void;
      onScreenshot: () => void;
      onToggleAmbient: () => void;
      onToggleFastForward: () => void;
      onStartFromLineage: (id: string) => void;
    },
  ) {
    this.harvestBtn.addEventListener('click', () => this.hooks.onHarvestSeed());
    this.screenshotBtn.addEventListener('click', () => this.hooks.onScreenshot());
    (el('toggle-ambient') as HTMLButtonElement).addEventListener('click', () => this.hooks.onToggleAmbient());
    // M16: ⏸ ▶ ▶▶ ▶▶▶ の4段ボタン。旧スライダー+⏩トグルは廃止したが、
    // 内部 API (onSpeed/onToggleFastForward) はそのまま使う。▶▶▶ だけが
    // 早送りフラグ (描画10fps化してtickに全振り) も同時にONにする。
    // 選択は localStorage に永続化し、次回起動時にも同じプリセットで始まる。
    const SPEED_PRESET_KEY = 'morpho.speedPreset.v1';
    type SpeedPreset = 'pause' | '1' | '8' | '24';
    const presets: { id: SpeedPreset; btn: HTMLButtonElement; speed: number; fastForward: boolean }[] = [
      { id: 'pause', btn: el('speed-btn-pause') as HTMLButtonElement, speed: 0, fastForward: false },
      { id: '1', btn: el('speed-btn-1') as HTMLButtonElement, speed: 1, fastForward: false },
      { id: '8', btn: el('speed-btn-8') as HTMLButtonElement, speed: 8, fastForward: false },
      { id: '24', btn: el('speed-btn-24') as HTMLButtonElement, speed: 24, fastForward: true },
    ];
    const applyPreset = (id: SpeedPreset, persist: boolean): void => {
      const preset = presets.find((p) => p.id === id) ?? presets[1]!;
      for (const p of presets) p.btn.setAttribute('aria-pressed', String(p.id === preset.id));
      this.hooks.onSpeed(preset.speed);
      if (this.game.fastForward !== preset.fastForward) this.hooks.onToggleFastForward();
      if (persist) {
        try { localStorage.setItem(SPEED_PRESET_KEY, preset.id); } catch { /* private mode 等は諦める */ }
      }
    };
    for (const p of presets) p.btn.addEventListener('click', () => applyPreset(p.id, true));
    this.logAreaToggle.addEventListener('click', () => {
      this.areaWatch = !this.areaWatch;
      this.logAreaToggle.setAttribute('aria-pressed', String(this.areaWatch));
      this.logAreaLabel.hidden = !this.areaWatch;
      // render() の filterKey に areaWatch の状態が織り込まれるため、次の
      // render() 呼び出しで自動的に再描画される (ここで明示的にキャッシュを
      // 破棄する必要はない)。
    });
    let initialPreset: SpeedPreset = '1';
    try {
      const saved = localStorage.getItem(SPEED_PRESET_KEY);
      if (saved === 'pause' || saved === '1' || saved === '8' || saved === '24') initialPreset = saved;
    } catch { /* private mode 等は既定の '1' のまま */ }
    if (initialPreset !== '1') applyPreset(initialPreset, false);
    document.querySelectorAll<HTMLButtonElement>('button.tool').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll<HTMLButtonElement>('button.tool').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const t = (b.dataset.tool ?? 'food') as Tool;
        this.hooks.onTool(t);
      });
    });
    const brush = el('brush') as HTMLInputElement;
    brush.addEventListener('input', () => {
      const v = Number(brush.value);
      this.brushN.textContent = String(v);
      this.hooks.onBrush(v);
    });
    (el('reset') as HTMLButtonElement).addEventListener('click', () => this.hooks.onReset());
    (el('toggle-heat') as HTMLButtonElement).addEventListener('click', () => this.hooks.onToggleHeat());
    (el('reset-view') as HTMLButtonElement).addEventListener('click', () => this.hooks.onResetView());
    const stageSelect = el('stage-select') as HTMLSelectElement;
    stageSelect.addEventListener('change', () => {
      this.hooks.onStageChange(stageSelect.value as StageId);
    });

    // M15: モバイル下部ツールバーの複製ボタンも含めて全件に active を付ける。
    document.querySelectorAll<HTMLButtonElement>('button.tool[data-tool="food"]').forEach((b) => b.classList.add('active'));

    // M18: 「収集・記録」タブ (図鑑/マップ/メモ)。選択は localStorage に永続化する。
    const RECORD_TAB_KEY = 'morpho.recordTab.v1';
    const selectRecordTab = (tab: string, persist: boolean): void => {
      for (const btn of this.recordTabs) btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
      for (const panel of this.recordPanels) panel.hidden = panel.dataset.panel !== tab;
      if (persist) {
        try { localStorage.setItem(RECORD_TAB_KEY, tab); } catch { /* private mode 等は諦める */ }
      }
    };
    for (const btn of this.recordTabs) {
      btn.addEventListener('click', () => selectRecordTab(btn.dataset.tab ?? 'ency', true));
    }
    let initialTab = 'ency';
    try {
      const saved = localStorage.getItem(RECORD_TAB_KEY);
      if (saved && this.recordTabs.some((b) => b.dataset.tab === saved)) initialTab = saved;
    } catch { /* private mode 等は既定の 'ency' のまま */ }
    if (initialTab !== 'ency') selectRecordTab(initialTab, false);

    // M18: メモ。「今日の成長を貼る」は現在のスナップショットから定型文を作る。
    (el('note-add') as HTMLButtonElement).addEventListener('click', () => {
      this.trackers.notes.add(this.game.snapshot().day, this.noteText.value);
      this.noteText.value = '';
    });
    (el('note-paste-summary') as HTMLButtonElement).addEventListener('click', () => {
      const snap = this.game.snapshot();
      const text = summaryText(snap.day, snap.traits.exploration, snap.traits.efficiency, snap.traits.stability, snap.world.massKg);
      this.noteText.value = this.noteText.value ? `${this.noteText.value}\n${text}` : text;
    });
  }

  // M17: extraEvo は main.ts 側で検出した突然変異・形質獲得イベント
  // (mutation-events.ts、web 側派生で sim 無改修) を「進化の記録」に合流させる。
  render(view?: WorldView, extraEvo: EvolutionLog[] = []): void {
    const s = this.game.snapshot();
    setText(this.day, String(s.day));
    setText(this.era, s.era.name);
    this.eraRing.style.setProperty('--era-progress', String(s.era.progress));
    this.eraRing.title = `次の時代まで ${pct(s.era.progress)}`;
    this.renderEraEta(s.era.name, s.era.progress);
    setText(this.stageName, s.stage.name);
    this.stageName.title = s.stage.description;
    if (this.lastStageId !== s.stage.id) {
      this.lastStageId = s.stage.id;
      const stageSelect = el('stage-select') as HTMLSelectElement;
      if (stageSelect.value !== s.stage.id) stageSelect.value = s.stage.id;
    }

    // メインクエスト (固定2本)
    const connectQuest = s.quests.find((q) => q.id === 'connect-all');
    const exploreQuest = s.quests.find((q) => q.id === 'explore-70');
    if (connectQuest) {
      setBar(this.qConnectBar, connectQuest.progress);
      setText(this.qConnectN, pct(connectQuest.progress));
    }
    if (exploreQuest) {
      setBar(this.qExploreBar, exploreQuest.progress);
      setText(this.qExploreN, pct(exploreQuest.progress));
    }
    const uniteQuest = s.quests.find((q) => q.id === 'unite-colonies');
    if (uniteQuest) {
      setBar(this.qUniteBar, uniteQuest.progress);
      setText(this.qUniteN, pct(uniteQuest.progress));
    }
    // M14: 大陸ステージのときだけカードを出す (他ステージでは landCoverage の
    // 意味が薄いため隠す)。
    const isContinent = s.stage.id === 'continent';
    if (this.qContinentItem.hidden !== !isContinent) this.qContinentItem.hidden = !isContinent;
    if (isContinent) {
      const continentQuest = s.quests.find((q) => q.id === 'continent-nutrient');
      if (continentQuest) {
        setBar(this.qContinentBar, continentQuest.progress);
        setText(this.qContinentN, pct(continentQuest.progress));
      }
    }

    // 系統樹: 採取できる日数に達したかどうかだけ見て、変わったときだけ書き換える。
    const harvestable = s.day >= HARVEST_MIN_DAY;
    if (this.lastHarvestable !== harvestable) {
      this.lastHarvestable = harvestable;
      this.harvestBtn.disabled = !harvestable;
      setText(this.harvestHint, harvestable ? '' : `Day ${HARVEST_MIN_DAY} で種を採取できるようになる`);
    }
    setText(this.lineageGen, `現在 ${this.trackers.lineage.nextGeneration()}代目`);

    // M11: チャレンジ一覧 (3種常時表示、達成状況が変わったときだけ書き換える)
    const chalKey = allChallenges().map((c) => `${c.kind}:${this.trackers.challenges.isCompleted(c.kind)}`).join(',');
    if (this.lastChalKey !== chalKey) {
      this.lastChalKey = chalKey;
      const completed = allChallenges().filter((c) => this.trackers.challenges.isCompleted(c.kind)).length;
      setText(this.chalProgress, `${completed}/3`);
      this.chalList.innerHTML = '';
      for (const chal of allChallenges()) {
        const done = this.trackers.challenges.isCompleted(chal.kind);
        const li = document.createElement('li');
        const title = document.createElement('div');
        title.className = 'challenge-title';
        const titleText = document.createElement('span');
        titleText.textContent = chal.title;
        title.appendChild(titleText);
        const desc = document.createElement('div');
        desc.className = 'challenge-desc';
        desc.textContent = chal.description;
        const goal = document.createElement('div');
        goal.className = 'challenge-goal';
        goal.textContent = chal.goal;
        const status = document.createElement('span');
        status.className = 'challenge-status';
        status.classList.toggle('done', done);
        status.textContent = done ? '達成済み ✓' : '挑戦中…';
        li.appendChild(title);
        li.appendChild(desc);
        li.appendChild(goal);
        li.appendChild(status);
        this.chalList.appendChild(li);
      }
    }

    // ワールド情報
    setText(this.wArea, thou(s.world.areaM2));
    setText(this.wMass, s.world.massKg.toFixed(2));
    setText(this.wLinks, thou(s.world.networkLinks));
    setText(this.wCr, String(s.world.coloniesReached));
    setText(this.wCt, String(s.world.coloniesTotal));
    setText(this.wNetworks, String(s.world.connectedNetworks));
    setText(this.wColonies, String(s.world.sourceColonies));

    // 環境バランス (5)
    setBar(this.eLight, s.balance.light);
    setBar(this.eTemp, s.balance.temperature);
    setBar(this.eMoi, s.balance.moisture);
    setBar(this.eNut, s.balance.nutrient);
    setBar(this.eTox, s.balance.toxin);
    setText(this.eLightN, pct(s.balance.light));
    setText(this.eTempN, pct(s.balance.temperature));
    setText(this.eMoiN, pct(s.balance.moisture));
    setText(this.eNutN, pct(s.balance.nutrient));
    setText(this.eToxN, pct(s.balance.toxin));

    // 個体ビュー (6軸 + タイプ)
    setText(this.indTypeN, s.typeInfo.label);
    setText(this.indTypeDesc, typeDescriptionFor(s.typeInfo.id));
    setBar(this.tHealth, s.individuality.health);
    setBar(this.tVitality, s.individuality.vitality);
    setBar(this.tExp, s.individuality.exploration);
    setBar(this.tEff, s.individuality.efficiency);
    setBar(this.tStb, s.individuality.stability);
    setBar(this.tAdapt, s.individuality.adaptability);
    setText(this.tHealthN, pct(s.individuality.health));
    setText(this.tVitalityN, pct(s.individuality.vitality));
    setText(this.tExpN, pct(s.individuality.exploration));
    setText(this.tEffN, pct(s.individuality.efficiency));
    setText(this.tStbN, pct(s.individuality.stability));
    setText(this.tAdaptN, pct(s.individuality.adaptability));

    // ログ (差分が出たときだけ書き換える)。M17: WorldEvent.id は単調増加なので
    // 「最新の id + 注視フィルタの状態」をキーに判定する (length だけだと、
    // 上限到達後は push しても length が変わらず更新を見逃す)。
    const allEvents = this.game.events();
    const latestId = allEvents[0]?.id ?? -1;
    const filterKey = this.areaWatch && view ? `${view.worldLeft.toFixed(1)}_${view.worldTop.toFixed(1)}_${view.worldSpan.toFixed(1)}` : '';
    const eventsKey = `${latestId}|${filterKey}`;
    if (this.lastEventFilterKey !== eventsKey) {
      const shown: readonly WorldEvent[] = this.areaWatch && view ? filterByArea(allEvents, view) : allEvents;
      this.log.innerHTML = '';
      for (const e of shown) {
        const li = document.createElement('li');
        const time = document.createElement('span');
        time.className = 'time';
        time.textContent = localTimeFor(e.tick).slice(0, 5);
        const body = document.createElement('span');
        body.className = 'body';
        body.textContent = e.text;
        li.appendChild(time);
        li.appendChild(body);
        this.log.appendChild(li);
      }
      this.lastEventFilterKey = eventsKey;
    }

    const evo = [...this.game.evolution(), ...extraEvo].sort((a, b) => b.tick - a.tick);
    if (this.lastEvoLen !== evo.length) {
      this.evo.innerHTML = '';
      if (evo.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'まだ何も起きていない…';
        this.evo.appendChild(li);
      } else {
        for (const e of evo) {
          const li = document.createElement('li');
          const time = document.createElement('span');
          time.className = 'time';
          // M15.7 で TICKS_PER_DAY は 40→240 に変わった。旧値 40 の
          // ハードコードが残っていたため、「進化の記録」の Day 表示だけが
          // ヘッダの DAY の6倍に膨らんでいた (実プレイ検証 第3回で発見)。
          const day = Math.floor(e.tick / TICKS_PER_DAY);
          time.textContent = `Day ${day}`;
          const body = document.createElement('span');
          body.className = 'body';
          body.textContent = e.text;
          li.appendChild(time);
          li.appendChild(body);
          this.evo.appendChild(li);
        }
      }
      this.lastEvoLen = evo.length;
    }

    // M13: 図鑑グリッド (バージョンが変わった = 新規発見・更新・お気に入り変更が
    // あったときだけ書き換える)。32枠すべてを固定順で並べ、未発見は「?」ロックにする。
    if (this.lastEncyVersion !== this.trackers.encyclopedia.version) {
      this.lastEncyVersion = this.trackers.encyclopedia.version;
      const discovered = this.trackers.encyclopedia.list();
      setText(this.encyProgress, `${discovered.length}/${allCatalogueEntries().length}`);
      this.ency.innerHTML = '';
      for (const meta of allCatalogueEntries()) {
        const entry = this.trackers.encyclopedia.entryOf(meta.id);
        const li = document.createElement('li');
        li.className = entry ? 'ency-slot discovered' : 'ency-slot locked';
        if (entry?.favorite) li.classList.add('favorite');

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'ency-thumb';
        const url = entry ? this.trackers.catalogueThumbs.urlOf(entry.id) : undefined;
        if (entry && url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = entry.name;
          thumbWrap.appendChild(img);
        } else if (!entry) {
          thumbWrap.textContent = '?';
        }
        if (entry) {
          const star = document.createElement('span');
          star.className = 'ency-star';
          star.textContent = '★'.repeat(starsOf(entry.individuality));
          thumbWrap.appendChild(star);
        }
        li.appendChild(thumbWrap);

        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = entry ? entry.name : '？？？';
        li.appendChild(label);

        if (entry) {
          li.title = `${entry.description}\n発見: Day ${entry.day}${entry.favorite ? ' ・ ♥ お気に入り' : ''}`;
          li.addEventListener('click', () => this.trackers.encyclopedia.toggleFavorite(entry.id));
        }
        this.ency.appendChild(li);
      }
    }

    // M18: メモ (バージョンが変わった = 追加/削除があったときだけ書き換える)
    if (this.lastNotesVersion !== this.trackers.notes.version) {
      this.lastNotesVersion = this.trackers.notes.version;
      const notes = this.trackers.notes.list();
      this.notesList.innerHTML = '';
      if (notes.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'まだメモがない…';
        this.notesList.appendChild(li);
      } else {
        for (const note of notes) {
          const li = document.createElement('li');
          const day = document.createElement('span');
          day.className = 'note-day';
          day.textContent = `Day ${note.day}`;
          const body = document.createElement('span');
          body.className = 'note-body';
          body.textContent = note.text;
          const del = document.createElement('button');
          del.className = 'note-del';
          del.textContent = '×';
          del.title = 'このメモを削除';
          del.addEventListener('click', () => this.trackers.notes.remove(note.id));
          li.appendChild(day);
          li.appendChild(body);
          li.appendChild(del);
          this.notesList.appendChild(li);
        }
      }
    }

    // アチーブメント (バージョンが変わった = 新規解除があったときだけ書き換える)
    if (this.lastAchVersion !== this.trackers.achievements.version) {
      this.lastAchVersion = this.trackers.achievements.version;
      const unlockedCount = ACHIEVEMENT_DEFS.filter((d) => this.trackers.achievements.isUnlocked(d.id)).length;
      setText(this.achProgress, `${unlockedCount}/${ACHIEVEMENT_DEFS.length}`);
      // M13: バッジグリッドへ (解除済み=アイコン、未解除=「?」ロック)。
      this.ach.innerHTML = '';
      for (const def of ACHIEVEMENT_DEFS) {
        const status = this.trackers.achievements.statusOf(def.id);
        const li = document.createElement('li');
        li.className = status ? 'ach-badge unlocked' : 'ach-badge locked';
        const icon = document.createElement('div');
        icon.className = 'ach-icon';
        icon.textContent = status ? '🏅' : '?';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = def.label;
        li.title = status ? `${def.description}\n解除: Day ${status.day}` : def.description;
        li.appendChild(icon);
        li.appendChild(label);
        this.ach.appendChild(li);
      }
    }

    // 記録 (バージョンが変わった = 新記録があったときだけ書き換える)
    if (this.lastBoardVersion !== this.trackers.scoreboard.version) {
      this.lastBoardVersion = this.trackers.scoreboard.version;
      const records = this.trackers.scoreboard.list();
      this.board.innerHTML = '';
      if (records.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'まだ記録がない…';
        this.board.appendChild(li);
      } else {
        for (const r of records) {
          const li = document.createElement('li');
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = r.stageName;
          const meta = document.createElement('span');
          meta.className = 'meta';
          const connectText = r.bestConnectDay !== null ? `最短${r.bestConnectDay}日` : '未接続';
          meta.textContent = `${connectText} ・ スコア${Math.round(r.bestScore * 100)}%`;
          li.appendChild(label);
          li.appendChild(meta);
          this.board.appendChild(li);
        }
      }
    }

    // M13: 系統樹を分岐ツリーへ (世代ごとの行に並べる simple tree)。
    // バージョンが変わった = 新規採取/起点変更、または M18 のサムネイル保存完了
    // (非同期で遅れて届く) があったときだけ書き換える。
    const lineageVersionKey = `${this.trackers.lineage.version}|${this.trackers.lineageThumbs.version}`;
    if (this.lastLineageVersion !== lineageVersionKey) {
      this.lastLineageVersion = lineageVersionKey;
      const entries = this.trackers.lineage.list();
      this.lineageList.innerHTML = '';
      if (entries.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = 'まだ種を採取していない…';
        this.lineageList.appendChild(p);
      } else {
        const activeId = this.trackers.lineage.activeAncestor()?.id;
        const byGeneration = new Map<number, typeof entries>();
        for (const e of entries) {
          const row = byGeneration.get(e.generation);
          if (row) row.push(e); else byGeneration.set(e.generation, [e]);
        }
        for (const gen of [...byGeneration.keys()].sort((a, b) => a - b)) {
          const row = document.createElement('div');
          row.className = 'lineage-row';
          for (const e of byGeneration.get(gen)!) {
            const node = document.createElement('div');
            node.className = e.id === activeId ? 'lineage-node active' : 'lineage-node';
            // M18: サムネイルがあれば表示 (採種時に main.ts が撮影して保存する)。
            // 無いノード (過去データ・撮影失敗) は文字表示のまま壊れない。
            const thumbUrl = this.trackers.lineageThumbs.urlOf(e.id);
            if (thumbUrl) {
              const thumb = document.createElement('img');
              thumb.className = 'lineage-thumb';
              thumb.src = thumbUrl;
              thumb.alt = e.typeLabel;
              node.appendChild(thumb);
            }
            const label = document.createElement('div');
            label.className = 'label';
            label.textContent = `${e.generation}代目 — ${e.typeLabel}`;
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = `Day ${e.day} ・ ${e.stageName}`;
            const startBtn = document.createElement('button');
            startBtn.className = 'lineage-start-btn';
            startBtn.textContent = 'この子から始める';
            startBtn.addEventListener('click', () => this.hooks.onStartFromLineage(e.id));
            node.appendChild(label);
            node.appendChild(meta);
            node.appendChild(startBtn);
            row.appendChild(node);
          }
          this.lineageList.appendChild(row);
        }
      }
    }

    // アルバム (バージョンが変わった = 撮影/削除があったときだけ書き換える)
    if (this.lastAlbumVersion !== this.trackers.album.version) {
      this.lastAlbumVersion = this.trackers.album.version;
      const shots = this.trackers.album.list();
      setText(this.albumCount, String(shots.length));
      this.albumGrid.innerHTML = '';
      if (shots.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'まだ撮影していない…';
        this.albumGrid.appendChild(empty);
      } else {
        for (const shot of [...shots].reverse()) {
          const fig = document.createElement('figure');
          fig.className = 'album-shot';
          const link = document.createElement('a');
          link.href = shot.url;
          link.download = `morpho-day${shot.day}-${shot.id}.png`;
          link.title = `Day ${shot.day} ・ ${shot.stageName} (クリックで保存)`;
          const img = document.createElement('img');
          img.src = shot.url;
          img.alt = `Day ${shot.day} のスクリーンショット`;
          link.appendChild(img);
          const del = document.createElement('button');
          del.className = 'album-shot-del';
          del.type = 'button';
          del.title = '削除';
          del.textContent = '×';
          del.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.trackers.album.remove(shot.id);
          });
          fig.appendChild(link);
          fig.appendChild(del);
          this.albumGrid.appendChild(fig);
        }
      }
    }
  }

  // M16: 時代の残り時間予測。2.5秒に1点、progress を実時間軸でサンプリング
  // する (毎フレームは不要 — sim tick の粒度からしても過剰)。時代名が変わった
  // ら履歴をリセットし、切替直後の古い速度で誤った ETA を出さないようにする。
  private renderEraEta(eraName: string, progress: number): void {
    if (this.lastEraNameForEta !== eraName) {
      this.lastEraNameForEta = eraName;
      this.eraSamples = [];
      this.lastEraSampleAtMs = 0;
    }
    const now = performance.now();
    if (now - this.lastEraSampleAtMs >= this.ERA_SAMPLE_INTERVAL_MS) {
      this.lastEraSampleAtMs = now;
      this.eraSamples.push({ atMs: now, progress });
      if (this.eraSamples.length > this.ERA_SAMPLE_MAX) this.eraSamples.shift();
    }
    const etaMs = estimateEraEta(this.eraSamples);
    setText(this.eraEtaEl, etaMs === null ? '次の時代まで —' : `次の時代まで あと ${formatMMSS(etaMs / 1000)}`);
  }
}
