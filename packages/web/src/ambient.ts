// M7: 環境音 + アンビエントBGM。
//
// 外部音声ファイルを持ち込まず、WebAudio だけで手続き的に生成する
// (PWA のオフライン起動方針とも相性がよい — キャッシュすべきアセットが増えない)。
//   - ドローン層: 低い正弦波を数本重ねた持続音 (ステージごとに音高/響きが変わる)
//   - ノイズ層: フィルタ済みホワイトノイズ (風/水のテクスチャ)
//   - LFO: ノイズのフィルタカットオフをゆっくり揺らして「呼吸」させる
//   - きらめき: ステージごとの間隔でランダムに鳴る短いピン (洞窟の水滴、湿地の虫の音 等)
//
// AudioContext はブラウザの自動再生ポリシーによりユーザー操作なしでは
// 音を出せない (生成しても suspended のまま)。そのため生成・resume は
// 必ずトグルボタンのクリックハンドラ (= ユーザー操作) から呼ぶ。

import type { StageId } from './stages.js';

interface StageAmbientProfile {
  droneFreq: number;       // ドローンの基音 (Hz)
  droneFilterFreq: number; // ドローン全体にかけるローパスの基準カットオフ
  droneGain: number;
  noiseFilterFreq: number; // ノイズにかけるフィルタの基準カットオフ
  noiseFilterQ: number;
  noiseGain: number;
  noiseFilterType: BiquadFilterType;
  sparkle: { minMs: number; maxMs: number; freq: number; freqJitter: number; gain: number; decay: number } | null;
}

const PROFILES: Record<StageId, StageAmbientProfile> = {
  petri: {
    droneFreq: 82, droneFilterFreq: 420, droneGain: 0.05,
    noiseFilterFreq: 700, noiseFilterQ: 0.5, noiseGain: 0.02, noiseFilterType: 'lowpass',
    sparkle: { minMs: 6000, maxMs: 12000, freq: 660, freqJitter: 200, gain: 0.03, decay: 1.4 },
  },
  cave: {
    droneFreq: 55, droneFilterFreq: 260, droneGain: 0.06,
    noiseFilterFreq: 340, noiseFilterQ: 0.7, noiseGain: 0.03, noiseFilterType: 'lowpass',
    sparkle: { minMs: 3500, maxMs: 8000, freq: 320, freqJitter: 60, gain: 0.05, decay: 2.2 }, // 水滴
  },
  desert: {
    droneFreq: 98, droneFilterFreq: 520, droneGain: 0.035,
    noiseFilterFreq: 1400, noiseFilterQ: 0.3, noiseGain: 0.045, noiseFilterType: 'highpass',
    sparkle: { minMs: 9000, maxMs: 18000, freq: 900, freqJitter: 300, gain: 0.02, decay: 1.0 },
  },
  ruins: {
    droneFreq: 73, droneFilterFreq: 300, droneGain: 0.05,
    noiseFilterFreq: 900, noiseFilterQ: 0.6, noiseGain: 0.03, noiseFilterType: 'bandpass',
    sparkle: { minMs: 5000, maxMs: 11000, freq: 200, freqJitter: 40, gain: 0.035, decay: 1.8 }, // 軋み
  },
  wetland: {
    droneFreq: 65, droneFilterFreq: 380, droneGain: 0.05,
    noiseFilterFreq: 600, noiseFilterQ: 0.8, noiseGain: 0.035, noiseFilterType: 'lowpass',
    sparkle: { minMs: 1200, maxMs: 3200, freq: 1400, freqJitter: 500, gain: 0.025, decay: 0.35 }, // 虫の音
  },
  continent: {
    droneFreq: 70, droneFilterFreq: 340, droneGain: 0.05,
    noiseFilterFreq: 900, noiseFilterQ: 0.4, noiseGain: 0.04, noiseFilterType: 'lowpass',
    sparkle: { minMs: 4000, maxMs: 9000, freq: 500, freqJitter: 250, gain: 0.03, decay: 1.6 }, // 遠い波音
  },
};

const RAMP_S = 3; // ステージ切り替え時のパラメータ遷移時間

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class Ambient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private droneGain: GainNode | null = null;
  private noiseFilter: BiquadFilterNode | null = null;
  private noiseGain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private stage: StageId = 'petri';
  private sparkleTimer: ReturnType<typeof setTimeout> | null = null;
  private _enabled = false;

  get enabled(): boolean { return this._enabled; }

  // ユーザーがトグルを押したときだけ呼ぶ (自動再生ポリシー対応)。
  async setEnabled(v: boolean): Promise<void> {
    this._enabled = v;
    if (v) {
      this.ensureGraph();
      await this.ctx!.resume();
      this.master!.gain.cancelScheduledValues(this.ctx!.currentTime);
      this.master!.gain.linearRampToValueAtTime(1, this.ctx!.currentTime + 1.2);
      this.scheduleSparkle();
    } else if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
      if (this.sparkleTimer !== null) { clearTimeout(this.sparkleTimer); this.sparkleTimer = null; }
    }
  }

  setStage(id: StageId): void {
    this.stage = id;
    if (!this.ctx || !this.droneFilter) return; // まだ音を出していないなら次回 setEnabled 時に反映される
    this.applyProfile(PROFILES[id]);
  }

  private ensureGraph(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.master = master;

    // ドローン: 基音 + 5度 + オクターブを重ねてローパスに通す。
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.connect(master);
    this.droneFilter = droneFilter;

    const droneGain = ctx.createGain();
    droneGain.connect(droneFilter);
    this.droneGain = droneGain;

    for (const ratio of [1, 1.5, 2]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = PROFILES[this.stage].droneFreq * ratio;
      osc.connect(droneGain);
      osc.start();
      this.oscillators.push(osc);
    }

    // ゆっくり揺れる LFO でノイズのフィルタカットオフを「呼吸」させる。
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain);
    lfo.start();
    this.oscillators.push(lfo);

    // ノイズ層: 風/水のテクスチャ。
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoiseBuffer(ctx);
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    lfoGain.connect(noiseFilter.frequency);
    const noiseGain = ctx.createGain();
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start();
    this.noiseFilter = noiseFilter;
    this.noiseGain = noiseGain;

    this.applyProfile(PROFILES[this.stage], true);
  }

  private applyProfile(p: StageAmbientProfile, immediate = false): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const ramp = immediate ? 0 : RAMP_S;
    const targets: [AudioParam, number][] = [
      [this.droneFilter!.frequency, p.droneFilterFreq],
      [this.droneGain!.gain, p.droneGain],
      [this.noiseFilter!.frequency, p.noiseFilterFreq],
      [this.noiseFilter!.Q, p.noiseFilterQ],
      [this.noiseGain!.gain, p.noiseGain],
    ];
    for (const [param, value] of targets) {
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(value, t + Math.max(ramp, 0.01));
    }
    this.noiseFilter!.type = p.noiseFilterType;
    for (let i = 0; i < 3; i++) {
      const ratio = [1, 1.5, 2][i]!;
      const osc = this.oscillators[i];
      if (!osc) continue;
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(osc.frequency.value, t);
      osc.frequency.linearRampToValueAtTime(p.droneFreq * ratio, t + Math.max(ramp, 0.01));
    }
  }

  // ステージごとにランダムな間隔で短いピン (水滴/虫の音/軋み) を鳴らす。
  private scheduleSparkle(): void {
    if (!this._enabled || !this.ctx) return;
    const profile = PROFILES[this.stage];
    const spec = profile.sparkle;
    if (!spec) { this.sparkleTimer = setTimeout(() => this.scheduleSparkle(), 4000); return; }
    const delay = spec.minMs + Math.random() * (spec.maxMs - spec.minMs);
    this.sparkleTimer = setTimeout(() => {
      this.playSparkle(spec);
      this.scheduleSparkle();
    }, delay);
  }

  private playSparkle(spec: NonNullable<StageAmbientProfile['sparkle']>): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = spec.freq + (Math.random() * 2 - 1) * spec.freqJitter;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(spec.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + spec.decay);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + spec.decay + 0.05);
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
  }
}
