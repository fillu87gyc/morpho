// HUD と入力。DOM 更新を集約。
// - 値が変わったところだけ書き換える (textContent が等しければスキップ)。

import type { Game, Tool } from './game.js';

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

export class Ui {
  private day = el('day');
  private era = el('era');
  private nodes = el('k-nodes');
  private edges = el('k-edges');
  private thick = el('k-thick');
  private food = el('k-food');
  private tExp = el('t-explore');
  private tEff = el('t-efficient');
  private tStb = el('t-stable');
  private tExpN = el('t-explore-n');
  private tEffN = el('t-efficient-n');
  private tStbN = el('t-stable-n');
  private eNut = el('e-nutrient');
  private eMoi = el('e-moisture');
  private eLit = el('e-light');
  private eNutN = el('e-nutrient-n');
  private eMoiN = el('e-moisture-n');
  private eLitN = el('e-light-n');
  private questBar = el('quest-bar');
  private questPct = el('quest-pct');
  private brushN = el('brush-n');
  private log = el('log');

  constructor(
    private game: Game,
    private hooks: {
      onSpeed: (s: number) => void;
      onTool: (t: Tool) => void;
      onBrush: (r: number) => void;
      onReset: () => void;
      onToggleHeat: () => void;
    },
  ) {
    // 速度
    document.querySelectorAll<HTMLButtonElement>('button.speed').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll<HTMLButtonElement>('button.speed').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const s = Number(b.dataset.speed ?? 1);
        this.hooks.onSpeed(s);
      });
    });
    // ツール
    document.querySelectorAll<HTMLButtonElement>('button.tool').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll<HTMLButtonElement>('button.tool').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const t = (b.dataset.tool ?? 'food') as Tool;
        this.hooks.onTool(t);
      });
    });
    // ブラシ
    const brush = el('brush') as HTMLInputElement;
    brush.addEventListener('input', () => {
      const v = Number(brush.value);
      this.brushN.textContent = String(v);
      this.hooks.onBrush(v);
    });
    // リセット / ヒート
    (el('reset') as HTMLButtonElement).addEventListener('click', () => this.hooks.onReset());
    (el('toggle-heat') as HTMLButtonElement).addEventListener('click', () => this.hooks.onToggleHeat());

    // 初期ツール強調
    document.querySelector<HTMLButtonElement>('button.tool[data-tool="food"]')?.classList.add('active');
  }

  render(): void {
    const s = this.game.snapshot();
    setText(this.day, String(s.day));
    setText(this.era, eraName(s.day));
    setText(this.nodes, String(s.state.nodes.length));
    setText(this.edges, String(s.state.edges.length));
    setText(this.thick, String(s.thickEdges));
    setText(this.food, String(s.foodSpots));

    setBar(this.tExp, s.traits.exploration);
    setBar(this.tEff, s.traits.efficiency);
    setBar(this.tStb, s.traits.stability);
    setText(this.tExpN, pct(s.traits.exploration));
    setText(this.tEffN, pct(s.traits.efficiency));
    setText(this.tStbN, pct(s.traits.stability));

    setBar(this.eNut, s.balance.nutrient);
    setBar(this.eMoi, s.balance.moisture);
    setBar(this.eLit, s.balance.light);
    setText(this.eNutN, pct(s.balance.nutrient));
    setText(this.eMoiN, pct(s.balance.moisture));
    setText(this.eLitN, pct(s.balance.light));

    // メインクエスト: 「太い幹 ÷ 食料拠点」っぽい代理指標で十分
    const goal = Math.min(1, (s.thickEdges + s.state.edges.length * 0.2) / 60);
    setBar(this.questBar, goal);
    setText(this.questPct, String(Math.round(goal * 100)));

    // ログ
    const events = this.game.events();
    if (this.log.childElementCount !== events.length) {
      this.log.innerHTML = '';
      for (const e of events) {
        const li = document.createElement('li');
        li.textContent = e;
        this.log.appendChild(li);
      }
    }
  }
}

function eraName(day: number): string {
  if (day < 10) return '胞子期';
  if (day < 25) return '拡散期';
  if (day < 60) return '変形体期';
  return '成熟期';
}

function pct(v: number): string { return `${Math.round(v * 100)}%`; }
