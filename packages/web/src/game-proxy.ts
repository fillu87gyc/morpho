// メインスレッド側のプロキシ。sim-worker.ts と同じ公開面 (tool /
// brushRadius / speed / worldSize / fieldSize / env / bio / snapshot() /
// events() / evolution() / setTool / setBrush / setSpeed / apply / reset)
// を持ち、main.ts / ui.ts からは Game を直接使っていた頃と同じ書き味で
// 呼べる。実体は Worker とのメッセージ往復に過ぎない。

import { WORLD, FIELD, type Tool, type GameSnapshot, type EvolutionLog, type StageId } from './game.js';
import type { ToWorkerMessage, FromWorkerMessage, PerfInfo } from './worker-protocol.js';
import type { MacroToolId } from './macro-tools.js';
import type { Genome, SimState, Vec2 } from '@morpho/sim';
import { unpackNodes, unpackEdges } from './snapshot-codec.js';
import type { WorldEvent } from './world-events.js';
import { readDayMsOverride } from './time-scale.js';
import type { WorldOverview } from './world-overview.js';

const NO_PERF: PerfInfo = { tickMs: 0, targetSpeed: 0, effectiveSpeed: 0, daysPerMin: 0, dormantCells: 0, evictedChunks: 0 };

export class GameProxy {
  private worker: Worker;
  private latest: GameSnapshot | null = null;
  private recentEvents: readonly WorldEvent[] = [];
  private evoLog: EvolutionLog[] = [];
  private latestPerf: PerfInfo = NO_PERF;
  // M9: Worker が日境界に到達して自動停止したことを、メインループが
  // 1回だけ拾えるようにするフラグ (consumeDayCompleted で読むと消費される)。
  private dayCompletedFlag = false;
  // M25: 直近の snapshot メッセージに乗ってきた窓シフト量。main.ts が毎フレーム
  // consumeWindowShift() で1度だけ読む (消費型、Game 本体の同名メソッドと同じ設計)。
  private pendingWindowShift: Vec2 | null = null;
  // M28: 「原野」の全世界俯瞰の最新値。Worker から低頻度で届く (sim-worker.ts)。
  // null = まだ届いていない、または現在のステージが有界 (worldOverview は送られない)。
  private latestWorldOverview: WorldOverview | null = null;

  tool: Tool = 'food';
  brushRadius = 5;
  speed = 1;
  worldSize = WORLD;
  fieldSize = FIELD;
  fastForward = false;

  // parentGenome を渡すと、Worker 起動直後の初期個体をその継承先で始める
  // (M5: 系統樹の続きをセッションをまたいで再開する)。parentMutationBoost は
  // その種の採種時に記録された変異幅の倍率 (M30、lineage.ts 参照)。
  constructor(parentGenome?: Genome, parentMutationBoost?: number) {
    this.worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'snapshot') {
        // M8 P2: nodes/edges は Float32Array で届くので、既存のコンシューマ
        // (render.ts / quests.ts 等) がそのまま使えるようオブジェクトに復元する。
        const { stateMeta, nodesBuf, edgesBuf, ...rest } = msg.snapshot;
        const state: SimState = { ...stateMeta, nodes: unpackNodes(nodesBuf), edges: unpackEdges(edgesBuf) };
        this.latest = { ...rest, state } as GameSnapshot;
        this.recentEvents = msg.events;
        this.evoLog = msg.evolution;
        this.latestPerf = msg.perf;
        // M25: 複数回ぶんの windowShift が1つの snapshot に集約されている
        // 可能性があるので、既に溜まっている分に加算する (取りこぼし防止)。
        if (msg.windowShift) {
          this.pendingWindowShift = {
            x: (this.pendingWindowShift?.x ?? 0) + msg.windowShift.x,
            y: (this.pendingWindowShift?.y ?? 0) + msg.windowShift.y,
          };
        }
      } else if (msg.type === 'dayCompleted') {
        this.dayCompletedFlag = true;
      } else if (msg.type === 'worldOverview') {
        this.latestWorldOverview = msg.overview;
      }
    };
    // M15.7: URL パラメータ/localStorage による日長の上書き (開発/e2e 用フック)。
    // reset より前に送り、起動直後の tick から新しいペースを使う。
    this.send({ type: 'setDayMs', ms: readDayMsOverride() });
    if (parentGenome) this.send({ type: 'reset', parentGenome, parentMutationBoost });
  }

  // Worker からの初回スナップショットが届くまでは描画できない。
  get ready(): boolean { return this.latest !== null; }

  get env(): GameSnapshot['env'] { return this.current().env; }
  get bio(): GameSnapshot['bio'] { return this.current().bio; }

  private current(): GameSnapshot {
    if (!this.latest) throw new Error('GameProxy: no snapshot yet (check .ready first)');
    return this.latest;
  }

  private send(msg: ToWorkerMessage): void { this.worker.postMessage(msg); }

  setTool(t: Tool): void { this.tool = t; this.send({ type: 'setTool', tool: t }); }
  setBrush(r: number): void { this.brushRadius = r; this.send({ type: 'setBrush', radius: r }); }
  setSpeed(s: number): void { this.speed = Math.max(0, s | 0); this.send({ type: 'setSpeed', speed: this.speed }); }
  // M8 P4: 早送りモード。描画/スナップショット送信を10fpsまで落とし、
  // 浮いた予算をtickに全振りするよう Worker に伝える。
  setFastForward(v: boolean): void { this.fastForward = v; this.send({ type: 'setFastForward', enabled: v }); }
  apply(pos: Vec2): void { this.send({ type: 'apply', pos }); }
  // M31: 大局介入 (マクロツール、原野の俯瞰専用)。dir は「肥沃な帯」の
  // ドラッグベクトル (省略可 — Game 側が母体から離れる向きへフォールバック)。
  applyMacro(tool: MacroToolId, pos: Vec2, dir?: Vec2): void { this.send({ type: 'applyMacro', tool, pos, dir }); }
  reset(seed?: number, stageId?: StageId, parentGenome?: Genome, parentMutationBoost?: number): void {
    this.send({ type: 'reset', seed, stageId, parentGenome, parentMutationBoost });
    this.dayCompletedFlag = false;
    // M28: 前ステージ (原野) の俯瞰を持ち越さない — 有界ステージへ切り替えた
    // 場合、Worker は worldOverview を二度と送らないので、ここで消しておく。
    this.latestWorldOverview = null;
  }
  // M9: target tick まで自動で進め、到達したら Worker が speed=0 に止める。
  // null で日境界のキャップを解除する。
  runUntilTick(target: number | null): void { this.send({ type: 'runUntilTick', target }); }
  // M10: 「やり直す」。stroke 境界は main.ts の pointerdown/pointerup から呼ぶ。
  beginStroke(): void { this.send({ type: 'beginStroke' }); }
  endStroke(): void { this.send({ type: 'endStroke' }); }
  undoStroke(): void { this.send({ type: 'undoStroke' }); }
  // 直近で日境界に到達していたら true を1度だけ返す (消費型)。
  consumeDayCompleted(): boolean {
    const v = this.dayCompletedFlag;
    this.dayCompletedFlag = false;
    return v;
  }
  // M25: Game.consumeWindowShift() と同じ意味・同じ消費型 API。
  consumeWindowShift(): Vec2 | null {
    const v = this.pendingWindowShift;
    this.pendingWindowShift = null;
    return v;
  }
  // M28: 「原野」の全世界俯瞰の最新値 (消費型ではない — 常に最後に届いた値)。
  worldOverview(): WorldOverview | null { return this.latestWorldOverview; }

  snapshot(): GameSnapshot { return this.current(); }
  events(): readonly WorldEvent[] { return this.recentEvents; }
  evolution(): EvolutionLog[] { return this.evoLog; }
  perf(): PerfInfo { return this.latestPerf; }
}
