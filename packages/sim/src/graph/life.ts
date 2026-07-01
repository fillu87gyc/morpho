// 「生命」サブステップ: 1 エッジを 1 つの個体と見て、
//   - 自身を場に書き込み (Activity / Biomass)、
//   - 場と環境を参照して activity / fatigue / stress / radius を更新する。
// step.ts のかわりにここに集約することで、ローカル則を一望できるようにする。

import type { SimState, SimEdge, Vec2 } from '../types.js';
import type { Environment } from '../env/environment.js';
import type { ActivityField } from '../env/activity-field.js';
import type { BiomassField } from '../env/biomass-field.js';
import type { EventBus } from '../events/bus.js';
import type { SimParams } from './params.js';
import { type NodeIndex, clamp01, crowdingAt } from './index-utils.js';

// ── Activity: 場に書く → 拡散 → 各エッジが場を読んで自分を更新 ─

export function updateActivity(
  state: SimState, env: Environment, actField: ActivityField,
  params: SimParams, idx: NodeIndex,
): void {
  // 自身の activity を場に書き込む (伝播の源泉)
  for (const e of state.edges) {
    if (e.activity < 0.1) continue;
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    actField.deposit(
      { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
      e.activity * params.activityDeposit, 3,
    );
  }
  actField.diffuse(params.activityFieldDecay, params.activityFieldDiffusion);

  // 各エッジが場を参照して自身を更新
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    const mid: Vec2 = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
    const ctx = env.sampleGrowthContext(mid);
    const fluxN = Math.min(1, e.flux / params.fluxNormalize);
    const youth = Math.max(0, 1 - (state.tick - e.bornAt) / 100);

    const newActivity = clamp01(
      params.wFlux * fluxN +
      params.wNutrient * ctx.nutrients +
      params.wActivityField * Math.min(1, actField.sample(mid)) +
      0.8 * youth -
      params.wFatigue * Math.min(1, e.fatigue) -
      params.wCrowding * crowdingAt(state, mid, 4),
    );
    e.activity = e.activity * 0.85 + newActivity * 0.15;

    e.fatigue += e.activity * params.fatigueGrow - fluxN * params.fatigueRecover;
    if (e.fatigue < 0) e.fatigue = 0;
    if (e.fatigue > 3) e.fatigue = 3;

    e.stress *= 0.99; // 自然減衰のみ (増加は growth が担当)
    if (e.stress > 2) e.stress = 2;
  }
}

// ── Biomass: 各エッジが自分の体を場に滲ませる ──
//
// 「枝が伸びる」から「膜が広がる」に見せるための核となる処理。
// 中点に一発落とすのではなく、線分全体に沿ってディスクを重ねる。
// 結果として隣接する複数のエッジの biomass は互いに重なり合い、
// 観測時には一本の線ではなく「面」として見える。

export function updateBiomass(
  state: SimState, bioField: BiomassField, params: SimParams, idx: NodeIndex,
): void {
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    // activity と太さの両方が乗ることで、活きた幹は厚く、瀕死の細枝は薄く。
    const amount = params.biomassDeposit * (0.25 + e.activity) * (0.5 + Math.min(2, e.radius));
    const r = params.biomassRadius + Math.min(1.8, e.radius * 0.6);
    bioField.depositSegment(a.pos, b.pos, amount, r);
  }
  bioField.diffuse(params.biomassDecay, params.biomassDiffusion);
}

// ── Radius: activity * flux で太る、fatigue で細る ─

export function updateRadius(state: SimState, params: SimParams, bus: EventBus): void {
  for (const e of state.edges) {
    const youth = Math.max(0, 1 - (state.tick - e.bornAt) / 80);
    const grow = e.activity * (Math.min(1, e.flux / 5) + youth * 0.3) * params.alpha;
    const shrink = (1 + e.fatigue) * params.beta * e.radius;
    const prev = e.radius;
    e.radius = Math.max(0, Math.min(4, e.radius + grow - shrink));
    if (e.radius - prev > 0.15) {
      bus.emit({ type: 'EdgeThickened', tick: state.tick, edgeId: e.id, radius: e.radius });
    }
  }
}

// 個別アクセスしたい場合用に re-export を残しておく
export type { SimEdge };
