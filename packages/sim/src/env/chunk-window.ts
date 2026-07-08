// M25 (無限ワールドの見せ方): チャンク窓アダプタ。
//
// ChunkedGridEnvironment はサンプリング (sampleGrowthContext) が O(1) で
// 任意のワールド座標に効くので、シミュレーション (step.ts/growth.ts) には
// このままで良い。無限化が難しいのは「render.ts/minimap.ts が 96×96 の
// 密な FieldGrid (GridEnvironment) を前提にしている」側であって、sim 側では
// ない。この密な前提を壊さず無限ワールドを描くために、前線の周りの
// span×span の窓だけを毎回 GridEnvironment へ焼き出す「窓アダプタ」を
// 用意する — render.ts/minimap.ts は既存の GridEnvironment 経路をそのまま
// 使い続けられる (無改修)。
//
// 焼き出しは「読み取り専用のスナップショット」であり、書き戻しはしない —
// プレイヤーツール (placeFood 等) は常に本体の ChunkedGridEnvironment へ
// 直接作用させ、次回の bake で自然に窓へ反映される。

import type { Vec2 } from '../types.js';
import { GridEnvironment } from './environment.js';
import type { ChunkedGridEnvironment } from './chunked-environment.js';
import type { ScalarField } from '../field/scalar-field.js';
import type { ChunkedScalarField } from '../field/chunked-scalar-field.js';

export interface ChunkWindowOptions {
  /** 窓が覆うワールド単位の一辺長。 */
  span: number;
  /** 焼き出す密グリッドの解像度 (GridEnvironment.fieldSize と同じ意味)。 */
  fieldSize?: number;
}

/**
 * source (無限ワールド本体) の origin (窓の左上、ワールド座標) からの
 * span×span 範囲を、既存の GridEnvironment 互換の密フィールドへ焼き出す。
 * target を渡すと (span/fieldSize が一致する限り) 再利用して確保コストを
 * 省く。焼いた GridEnvironment の座標系は「窓ローカル」(0..span) になる
 * — 呼び出し側は world 座標から origin を引いてから使う。
 */
export function bakeChunkWindow(
  source: ChunkedGridEnvironment,
  origin: Vec2,
  opts: ChunkWindowOptions,
  target?: GridEnvironment,
): GridEnvironment {
  const span = opts.span;
  const fieldSize = opts.fieldSize ?? 96;
  const grid = target && target.worldSize === span && target.fieldSize === fieldSize
    ? target
    : new GridEnvironment({
      worldSize: span, fieldSize,
      baseMoisture: source.baseMoisture, baseBrightness: source.baseBrightness, baseTemperature: source.baseTemperature,
    });
  const n = fieldSize;
  const cell = span / n;
  for (let j = 0; j < n; j++) {
    const wy = origin.y + (j + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const wx = origin.x + (i + 0.5) * cell;
      const idx = j * n + i;
      grid.nutrients.data[idx] = source.nutrients.sample(wx, wy);
      grid.moisture.data[idx] = source.moisture.sample(wx, wy);
      grid.brightness.data[idx] = source.brightness.sample(wx, wy);
      grid.obstacle.data[idx] = source.obstacle.sample(wx, wy);
      grid.temperature.data[idx] = source.temperature.sample(wx, wy);
      grid.toxin.data[idx] = source.toxin.sample(wx, wy);
      grid.water.data[idx] = source.water.sample(wx, wy);
    }
  }
  return grid;
}

/**
 * ChunkedActivityField/ChunkedBiomassField の窓 (origin からの span×span) を
 * 既存の ActivityField/BiomassField 互換の密フィールドへ焼き出す
 * (bakeChunkWindow の Activity/Biomass 版)。target は
 * `new ActivityField(span, fieldSize)` 等、呼び出し側が窓の span/fieldSize に
 * 合わせて構築済みのものを渡す (再利用/破棄の判断は呼び出し側の責務)。
 */
export function bakeScalarFieldWindow(
  source: ChunkedScalarField,
  origin: Vec2,
  span: number,
  target: ScalarField,
): void {
  const n = target.fieldSize;
  const cell = span / n;
  for (let j = 0; j < n; j++) {
    const wy = origin.y + (j + 0.5) * cell;
    for (let i = 0; i < n; i++) {
      const wx = origin.x + (i + 0.5) * cell;
      target.field.data[j * n + i] = source.sample({ x: wx, y: wy });
    }
  }
}

/**
 * 前線 (ノード群) の bbox が窓の縁から margin (span に対する割合) 以内へ
 * 近づいたときだけ、bbox 中心が窓の中心に来るような新しい origin を返す。
 * 近づいていなければ null (= 再焼き不要、bake コストを毎tick払わずに済む)。
 */
export function followWindowOrigin(
  currentOrigin: Vec2, nodePositions: readonly Vec2[], span: number, margin = 0.2,
): Vec2 | null {
  if (nodePositions.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of nodePositions) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const marginWorld = span * margin;
  const left = currentOrigin.x, top = currentOrigin.y;
  const right = left + span, bottom = top + span;
  const nearEdge = minX < left + marginWorld || minY < top + marginWorld ||
                    maxX > right - marginWorld || maxY > bottom - marginWorld;
  if (!nearEdge) return null;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x: cx - span / 2, y: cy - span / 2 };
}
