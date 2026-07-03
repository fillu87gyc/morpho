// HUD と入力。DOM 更新を集約。
// - 値が変わったところだけ書き換える (textContent が等しければスキップ)。
// - 数値はモックアップに合わせて千桁区切り。

import type { Tool, StageId } from './game.js';
import type { GameProxy } from './game-proxy.js';
import type { Encyclopedia } from './encyclopedia.js';
import { ACHIEVEMENT_DEFS, type Achievements } from './achievements.js';
import { dailyChallengeFor, type DailyChallengeTracker } from './challenges.js';
import type { Scoreboard } from './scoreboard.js';
import { HARVEST_MIN_DAY, type Lineage } from './lineage.js';

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
  private stageName = el('stage-name');
  // メインクエスト (固定2本)
  private qConnectBar = el('q-connect-bar');
  private qConnectN = el('q-connect-n');
  private qExploreBar = el('q-explore-bar');
  private qExploreN = el('q-explore-n');
  // デイリーチャレンジ
  private chalTitle = el('chal-title');
  private chalDesc = el('chal-desc');
  private chalGoal = el('chal-goal');
  private chalStatus = el('chal-status');
  // world info
  private wArea = el('w-area');
  private wMass = el('w-mass');
  private wLinks = el('w-links');
  private wCr = el('w-cr');
  private wCt = el('w-ct');
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
  // 図鑑
  private ency = el('ency');
  private encyProgress = el('ency-progress');
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
  // logs
  private log = el('log');
  private evo = el('evo');
  // brush
  private brushN = el('brush-n');

  private lastEvoLen = -1;
  private lastEventLen = -1;
  private lastEncyVersion = -1;
  private lastAchVersion = -1;
  private lastBoardVersion = -1;
  private lastLineageVersion = -1;
  private lastChalKey = '';
  private lastHarvestable = false;
  private lastStageId: StageId | null = null;

  constructor(
    private game: GameProxy,
    private trackers: {
      encyclopedia: Encyclopedia;
      achievements: Achievements;
      challenges: DailyChallengeTracker;
      scoreboard: Scoreboard;
      lineage: Lineage;
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
    },
  ) {
    this.harvestBtn.addEventListener('click', () => this.hooks.onHarvestSeed());
    // 再生速度: スライダーで連続的に選べる。一時停止ボタンは直前の速度を
    // 覚えておいて、押し直したときに同じ速度へ戻す。
    const pauseBtn = el('pause-toggle') as HTMLButtonElement;
    const speedSlider = el('speed-slider') as HTMLInputElement;
    const speedN = el('speed-n');
    let lastSpeed = Number(speedSlider.value) || 1;
    let paused = false;
    speedSlider.addEventListener('input', () => {
      const v = Number(speedSlider.value);
      lastSpeed = v;
      setText(speedN, String(v));
      if (!paused) this.hooks.onSpeed(v);
    });
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? '▶' : '⏸';
      pauseBtn.classList.toggle('active', paused);
      this.hooks.onSpeed(paused ? 0 : lastSpeed);
    });
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

    document.querySelector<HTMLButtonElement>('button.tool[data-tool="food"]')?.classList.add('active');
  }

  render(): void {
    const s = this.game.snapshot();
    setText(this.day, String(s.day));
    setText(this.era, s.era);
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

    // 系統樹: 採取できる日数に達したかどうかだけ見て、変わったときだけ書き換える。
    const harvestable = s.day >= HARVEST_MIN_DAY;
    if (this.lastHarvestable !== harvestable) {
      this.lastHarvestable = harvestable;
      this.harvestBtn.disabled = !harvestable;
      setText(this.harvestHint, harvestable ? '' : `Day ${HARVEST_MIN_DAY} で種を採取できるようになる`);
    }
    setText(this.lineageGen, `現在 ${this.trackers.lineage.nextGeneration()}代目`);

    // デイリーチャレンジ (日付が変わるか達成したときだけ書き換える)
    const today = new Date();
    const chal = dailyChallengeFor(today);
    const chalDone = this.trackers.challenges.isCompletedToday(today);
    const chalKey = `${chal.kind}:${chalDone}`;
    if (this.lastChalKey !== chalKey) {
      this.lastChalKey = chalKey;
      setText(this.chalTitle, chal.title);
      setText(this.chalDesc, chal.description);
      setText(this.chalGoal, chal.goal);
      setText(this.chalStatus, chalDone ? '本日の挑戦、達成済み ✓' : '挑戦中…');
      this.chalStatus.classList.toggle('done', chalDone);
    }

    // ワールド情報
    setText(this.wArea, thou(s.world.areaM2));
    setText(this.wMass, s.world.massKg.toFixed(2));
    setText(this.wLinks, thou(s.world.networkLinks));
    setText(this.wCr, String(s.world.coloniesReached));
    setText(this.wCt, String(s.world.coloniesTotal));

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

    // ログ (差分が出たときだけ書き換える)
    const events = this.game.events();
    if (this.lastEventLen !== events.length) {
      this.log.innerHTML = '';
      for (const e of events) {
        const li = document.createElement('li');
        li.textContent = e;
        this.log.appendChild(li);
      }
      this.lastEventLen = events.length;
    }

    const evo = this.game.evolution();
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
          const day = Math.floor(e.tick / 40);
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

    // 図鑑 (バージョンが変わった = 新規発見 or 更新があったときだけ書き換える)
    if (this.lastEncyVersion !== this.trackers.encyclopedia.version) {
      this.lastEncyVersion = this.trackers.encyclopedia.version;
      const entries = this.trackers.encyclopedia.list();
      setText(this.encyProgress, `${entries.length}/5`);
      this.ency.innerHTML = '';
      if (entries.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'まだ何も発見していない…';
        this.ency.appendChild(li);
      } else {
        for (const e of entries) {
          const li = document.createElement('li');
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = e.label;
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = `Day ${e.day}`;
          li.appendChild(label);
          li.appendChild(meta);
          this.ency.appendChild(li);
        }
      }
    }

    // アチーブメント (バージョンが変わった = 新規解除があったときだけ書き換える)
    if (this.lastAchVersion !== this.trackers.achievements.version) {
      this.lastAchVersion = this.trackers.achievements.version;
      const unlockedCount = ACHIEVEMENT_DEFS.filter((d) => this.trackers.achievements.isUnlocked(d.id)).length;
      setText(this.achProgress, `${unlockedCount}/${ACHIEVEMENT_DEFS.length}`);
      this.ach.innerHTML = '';
      for (const def of ACHIEVEMENT_DEFS) {
        const status = this.trackers.achievements.statusOf(def.id);
        const li = document.createElement('li');
        li.className = status ? 'unlocked' : 'locked';
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = (status ? '✓ ' : '🔒 ') + def.label;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = status ? `Day ${status.day}` : def.description;
        li.appendChild(label);
        li.appendChild(meta);
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

    // 系統樹 (バージョンが変わった = 新規採取があったときだけ書き換える)
    if (this.lastLineageVersion !== this.trackers.lineage.version) {
      this.lastLineageVersion = this.trackers.lineage.version;
      const entries = this.trackers.lineage.list();
      this.lineageList.innerHTML = '';
      if (entries.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'まだ種を採取していない…';
        this.lineageList.appendChild(li);
      } else {
        for (const e of [...entries].reverse()) {
          const li = document.createElement('li');
          const label = document.createElement('span');
          label.className = 'label';
          label.textContent = `${e.generation}代目 — ${e.typeLabel}`;
          const meta = document.createElement('span');
          meta.className = 'meta';
          meta.textContent = `Day ${e.day} ・ ${e.stageName}`;
          li.appendChild(label);
          li.appendChild(meta);
          this.lineageList.appendChild(li);
        }
      }
    }
  }
}
