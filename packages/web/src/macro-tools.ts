// M31: 大局介入 (マクロツール)。「環境を買う」— ズームアウト (zoom < 1 の
// 俯瞰、M28) 中だけ使える高価な広域介入を3種 (地熱は上げ/下げの2ボタン):
//
//   雨季を呼ぶ  — 指定点の周囲 数チャンクの湿度を一定期間底上げする
//   肥沃な帯    — 指定方向 (ドラッグ) に栄養の回廊を敷く
//   地熱        — 広域の温度を一定期間 上げる / 下げる
//
// 設計 (ROADMAP.md M31):
//   - 効果は sim の既存 Environment.placeX() だけで実現する (sim のローカル則は
//     無改修)。「一定期間」は web 側 (game.ts) が適用の記録 (ActiveMacroEffect)
//     を持ち、期間中は一定 tick ごとに place を再適用して維持する — sim に
//     期限の概念を持ち込まない。
//   - 価格は窓内ブラシの数十倍 (wallet.ts の TOOL_COSTS)。最安の「雨季」は
//     🪙 の詰み防止下限 (SIZUKU_FLOOR=20) と同額にし、残高が尽きても自動回復
//     だけで必ずまた1つ買える (詰み防止方針との整合)。
//   - このモジュールは純粋 (DOM も sim インスタンスも触らない): ツール定義と
//     幾何 (回廊のパッチ配置・方向の正規化・残り日数) を vitest で固定する。

import type { Vec2 } from '@morpho/sim';
import { TICKS_PER_DAY } from './day-loop.js';

export type MacroToolId = 'rain' | 'corridor' | 'geoheat' | 'geocool';

export interface MacroToolDef {
  id: MacroToolId;
  /** 正式名 (イベント/理由の文言に使う)。 */
  label: string;
  /** 効果半径 (ワールド単位)。回廊では帯の半幅。 */
  radius: number;
  /** 効果期間 (tick)。 */
  durationTicks: number;
  /** 期間中の再適用間隔 (tick)。環境の自然減衰に抗して効果を維持する。 */
  reapplyIntervalTicks: number;
  /** 発動時に一度だけ置く量。 */
  initialAmount: number;
  /** 再適用ごとに足す維持量 (減衰の補填なので初回より小さい)。 */
  maintainAmount: number;
}

// 効果半径 120 = チャンク (48) 2.5枚ぶん。窓 (100×100) より広い = 窓内ブラシ
// (半径 2〜16) では決して届かない「大局」のスケール。
const WIDE_RADIUS = 120;

export const MACRO_TOOLS: Record<MacroToolId, MacroToolDef> = {
  rain: {
    id: 'rain',
    label: '雨季を呼ぶ',
    radius: WIDE_RADIUS,
    durationTicks: 5 * TICKS_PER_DAY,
    // 湿度は moistureRelaxPerTick (原野 0.0009/tick) で基準値へ戻ろうとする
    // ため、60 tick (1/4日) ごとに薄く足して底上げを維持する。
    reapplyIntervalTicks: 60,
    initialAmount: 0.35,
    maintainAmount: 0.08,
  },
  corridor: {
    id: 'corridor',
    label: '肥沃な帯',
    radius: 12, // 帯の半幅
    durationTicks: 6 * TICKS_PER_DAY,
    // 手撒きの餌 (0.5 = 根を張れない刺激、game.ts) と違い、回廊は本物の
    // 食事の列 (0.8 > foodReachThreshold 0.55)。網はここに根を張って
    // 補給線を作れる。1日1回、薄く補給して「帯」であり続けさせる。
    reapplyIntervalTicks: TICKS_PER_DAY,
    initialAmount: 0.8,
    maintainAmount: 0.15,
  },
  geoheat: {
    id: 'geoheat',
    label: '地熱 (上げる)',
    radius: WIDE_RADIUS,
    durationTicks: 5 * TICKS_PER_DAY,
    reapplyIntervalTicks: 60,
    initialAmount: 0.12,
    maintainAmount: 0.05,
  },
  geocool: {
    id: 'geocool',
    label: '地熱 (下げる)',
    radius: WIDE_RADIUS,
    durationTicks: 5 * TICKS_PER_DAY,
    reapplyIntervalTicks: 60,
    initialAmount: 0.12,
    maintainAmount: 0.05,
  },
};

export const MACRO_TOOL_ORDER: MacroToolId[] = ['rain', 'corridor', 'geoheat', 'geocool'];

// ── 回廊の幾何 ──────────────────────────────────────────
// 肥沃な帯は「起点から指定方向へ、等間隔の栄養パッチを一列に敷く」。
// パッチ半径 10 / 間隔 24 で連続した帯に見え、全長は 24×(9-1)=192
// (チャンク4枚ぶん) — 荒地の横断 (差し渡し 約3チャンク、biomes.ts) を
// ちょうど一本で渡しきれるスケール。

export const CORRIDOR_SPACING = 24;
export const CORRIDOR_PATCH_COUNT = 9;
export const CORRIDOR_PATCH_RADIUS = 10;
export const CORRIDOR_LENGTH = CORRIDOR_SPACING * (CORRIDOR_PATCH_COUNT - 1);

// ドラッグ量がこの長さ (ワールド単位) 未満なら「方向指定なし」とみなし、
// フォールバック (母体から離れる向き) を使う。
export const MACRO_MIN_DRAG = 5;

// ドラッグベクトル dir を単位ベクトルへ正規化する。ドラッグが短すぎる /
// 無い場合は fallbackFrom → fallbackTo (母体 → クリック点 = 外へ向かう向き)
// を使い、それも退化していれば +x を返す (常に有効な単位ベクトルを返す)。
export function normalizeMacroDir(dir: Vec2 | undefined, fallbackFrom: Vec2, fallbackTo: Vec2): Vec2 {
  if (dir) {
    const len = Math.hypot(dir.x, dir.y);
    if (len >= MACRO_MIN_DRAG) return { x: dir.x / len, y: dir.y / len };
  }
  const fx = fallbackTo.x - fallbackFrom.x, fy = fallbackTo.y - fallbackFrom.y;
  const flen = Math.hypot(fx, fy);
  if (flen > 1e-6) return { x: fx / flen, y: fy / flen };
  return { x: 1, y: 0 };
}

// 回廊の栄養パッチ中心列。origin から unitDir 方向へ CORRIDOR_SPACING 間隔。
export function corridorPatchCenters(origin: Vec2, unitDir: Vec2): Vec2[] {
  const centers: Vec2[] = [];
  for (let i = 0; i < CORRIDOR_PATCH_COUNT; i++) {
    centers.push({ x: origin.x + unitDir.x * CORRIDOR_SPACING * i, y: origin.y + unitDir.y * CORRIDOR_SPACING * i });
  }
  return centers;
}

// ── 適用の記録 ──────────────────────────────────────────

// game.ts が保持する「働いている大局介入」。座標は実座標 (チャンク系)。
export interface ActiveMacroEffect {
  kind: MacroToolId;
  center: Vec2;
  /** 回廊のみ: 単位方向ベクトル。 */
  dir?: Vec2;
  expiresAtTick: number;
}

// 描画 (render.ts の大局レイヤー) 用のビュー。座標は窓ローカル。
export interface MacroEffectView {
  kind: MacroToolId;
  center: Vec2;
  dir?: Vec2;
  radius: number;
  /** 回廊のみ: 帯の全長 (ワールド単位)。 */
  lengthWorld?: number;
  remainingDays: number;
}

// 残り日数 (表示用)。期間中は最低 1 を返す (「あと0日」と出さない)。
export function macroRemainingDays(expiresAtTick: number, tick: number): number {
  return Math.max(1, Math.ceil((expiresAtTick - tick) / TICKS_PER_DAY));
}

// この tick で効果を再適用すべきか。発動 tick (expiresAtTick - durationTicks)
// を基準に一定間隔で真になる (tick() のステップループ内から毎 tick 呼ばれる
// 前提の決定的な判定 — steps のまとめ方に依存しない)。
export function shouldReapplyMacro(effect: ActiveMacroEffect, def: MacroToolDef, tick: number): boolean {
  const startedAt = effect.expiresAtTick - def.durationTicks;
  const elapsed = tick - startedAt;
  return elapsed > 0 && elapsed % def.reapplyIntervalTicks === 0;
}
