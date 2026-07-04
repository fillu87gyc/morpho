// メインスレッド側のプロキシ。sim-worker.ts と同じ公開面 (tool /
// brushRadius / speed / worldSize / fieldSize / env / bio / snapshot() /
// events() / evolution() / setTool / setBrush / setSpeed / apply / reset)
// を持ち、main.ts / ui.ts からは Game を直接使っていた頃と同じ書き味で
// 呼べる。実体は Worker とのメッセージ往復に過ぎない。

import { WORLD, FIELD, type Tool, type GameSnapshot, type EvolutionLog, type StageId } from './game.js';
import type { ToWorkerMessage, FromWorkerMessage, PerfInfo } from './worker-protocol.js';
import type { Genome, SimState, Vec2 } from '@morpho/sim';
import { unpackNodes, unpackEdges } from './snapshot-codec.js';

const NO_PERF: PerfInfo = { tickMs: 0, targetSpeed: 0, effectiveSpeed: 0 };

export class GameProxy {
  private worker: Worker;
  private latest: GameSnapshot | null = null;
  private recentEvents: string[] = [];
  private evoLog: EvolutionLog[] = [];
  private latestPerf: PerfInfo = NO_PERF;
  // M9: Worker が日境界に到達して自動停止したことを、メインループが
  // 1回だけ拾えるようにするフラグ (consumeDayCompleted で読むと消費される)。
  private dayCompletedFlag = false;

  tool: Tool = 'food';
  brushRadius = 5;
  speed = 1;
  worldSize = WORLD;
  fieldSize = FIELD;
  fastForward = false;

  // parentGenome を渡すと、Worker 起動直後の初期個体をその継承先で始める
  // (M5: 系統樹の続きをセッションをまたいで再開する)。
  constructor(parentGenome?: Genome) {
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
      } else if (msg.type === 'dayCompleted') {
        this.dayCompletedFlag = true;
      }
    };
    if (parentGenome) this.send({ type: 'reset', parentGenome });
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
  reset(seed?: number, stageId?: StageId, parentGenome?: Genome): void {
    this.send({ type: 'reset', seed, stageId, parentGenome });
    this.dayCompletedFlag = false;
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

  snapshot(): GameSnapshot { return this.current(); }
  events(): string[] { return this.recentEvents; }
  evolution(): EvolutionLog[] { return this.evoLog; }
  perf(): PerfInfo { return this.latestPerf; }
}
