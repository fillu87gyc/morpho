// HUD と入力。DOM 更新を集約。
// - 値が変わったところだけ書き換える (textContent が等しければスキップ)。
// - 数値はモックアップに合わせて千桁区切り。

import type { Tool } from './game.js';
import type { GameProxy } from './game-proxy.js';

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
  // quest
  private questBar = el('quest-bar');
  private questPct = el('quest-pct');
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
  // logs
  private log = el('log');
  private evo = el('evo');
  // brush
  private brushN = el('brush-n');

  private lastEvoLen = -1;
  private lastEventLen = -1;

  constructor(
    private game: GameProxy,
    private hooks: {
      onSpeed: (s: number) => void;
      onTool: (t: Tool) => void;
      onBrush: (r: number) => void;
      onReset: () => void;
      onToggleHeat: () => void;
      onResetView: () => void;
    },
  ) {
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

    document.querySelector<HTMLButtonElement>('button.tool[data-tool="food"]')?.classList.add('active');
  }

  render(): void {
    const s = this.game.snapshot();
    setText(this.day, String(s.day));
    setText(this.era, s.era);

    // クエスト
    setBar(this.questBar, s.questProgress);
    setText(this.questPct, String(Math.round(s.questProgress * 100)));

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

    // 個性
    setBar(this.tExp, s.traits.exploration);
    setBar(this.tEff, s.traits.efficiency);
    setBar(this.tStb, s.traits.stability);
    setText(this.tExpN, pct(s.traits.exploration));
    setText(this.tEffN, pct(s.traits.efficiency));
    setText(this.tStbN, pct(s.traits.stability));

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
  }
}
