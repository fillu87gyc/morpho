// 1 tick の進行を取りまとめる。サブステップの順序と頻度だけがここの責務。
//
//   毎 tick : flux → activity → biomass
//   4 tick  : radius
//   12 tick : growth
//   60 tick : prune
//
// 順序は意味がある:
//   - flux は最新の構造で計算する必要がある (枯死前)
//   - activity は flux を読むので flux の後
//   - biomass は activity を読まないが、growth が biomass を読むので
//     biomass は growth より前で常に更新しておく

import type { SimState } from '../types.js';
import type { Environment } from '../env/environment.js';
import type { ActivityField } from '../env/activity-field.js';
import type { BiomassField } from '../env/biomass-field.js';
import type { SeededRNG } from '../rng.js';
import type { EventBus } from '../events/bus.js';
import type { SimParams } from './params.js';
import { buildIndex } from './index-utils.js';
import { updateFlux } from './flux.js';
import { updateActivity, updateBiomass, updateRadius } from './life.js';
import { growthStep } from './growth.js';
import { prune } from './prune.js';

export function step(
  state: SimState, env: Environment, actField: ActivityField, bioField: BiomassField,
  params: SimParams, rng: SeededRNG, bus: EventBus,
): void {
  state.tick++;
  const idx = buildIndex(state);
  updateFlux(state, params, idx);
  updateActivity(state, env, actField, params, idx);
  // Biomass は毎 tick: 場が拡散・減衰しながら膜のかたちを保つ。
  updateBiomass(state, bioField, params, idx);
  if (state.tick % 4 === 0)  updateRadius(state, params, bus);
  if (state.tick % 12 === 0) growthStep(state, env, bioField, params, rng, bus, idx);
  if (state.tick % 60 === 0) prune(state, params, bus);
}

export function run(
  state: SimState, env: Environment, actField: ActivityField, bioField: BiomassField,
  params: SimParams, rng: SeededRNG, bus: EventBus, ticks: number,
): void {
  for (let i = 0; i < ticks; i++) step(state, env, actField, bioField, params, rng, bus);
}
