// メインスレッド側のプロキシ。sim-worker.ts と同じ公開面 (tool /
// brushRadius / speed / worldSize / fieldSize / env / bio / snapshot() /
// events() / evolution() / setTool / setBrush / setSpeed / apply / reset)
// を持ち、main.ts / ui.ts からは Game を直接使っていた頃と同じ書き味で
// 呼べる。実体は Worker とのメッセージ往復に過ぎない。

import { WORLD, FIELD, type Tool, type GameSnapshot, type EvolutionLog } from './game.js';
import type { ToWorkerMessage, FromWorkerMessage } from './worker-protocol.js';

export class GameProxy {
  private worker: Worker;
  private latest: GameSnapshot | null = null;
  private recentEvents: string[] = [];
  private evoLog: EvolutionLog[] = [];

  tool: Tool = 'food';
  brushRadius = 5;
  speed = 1;
  worldSize = WORLD;
  fieldSize = FIELD;

  constructor() {
    this.worker = new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'snapshot') {
        this.latest = msg.snapshot;
        this.recentEvents = msg.events;
        this.evoLog = msg.evolution;
      }
    };
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
  apply(canvasX: number, canvasY: number, canvasSize: number): void {
    this.send({ type: 'apply', x: canvasX, y: canvasY, size: canvasSize });
  }
  reset(seed?: number): void { this.send({ type: 'reset', seed }); }

  snapshot(): GameSnapshot { return this.current(); }
  events(): string[] { return this.recentEvents; }
  evolution(): EvolutionLog[] { return this.evoLog; }
}
