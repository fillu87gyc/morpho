// M29: 成熟領域の休眠。
//
// 実測 (docs/playtest-2026-07-09-infinite/) で判明したボトルネックは
// 「全エッジを毎tick等しく更新する」こと — エッジ約7,000本で実効ペースが
// 公称の約300倍まで落ちる。粘菌の見た目の変化は前線に集中しているので、
// 「前線から遠く、構造の変化が止まった領域」を空間セル単位で休眠させ、
// life.ts の activity/fatigue/radius 更新とフィールド書き込みをスキップする。
//
// 設計上の決めごと:
//   - 「前線」= 最も新しく生まれたノードたちのセル (最大 dormancyFrontierCells
//     個)。絶対時刻 (「N tick 以内に生まれた」) で切らないのは2つ理由がある:
//     (1) forager の reclaim 循環はネットワーク全体に誕生を撒き続けるため、
//     絶対時刻の基準では成熟した内奥がいつまでも「前線」扱いになり休眠が
//     効かない (実測済み)。(2) 上限 K で切ると起きているセル数が構造的に
//     有界 (≤ K×(2margin+1)²) になり、「コストが前線サイズに比例し総経過
//     時間に比例しない」が判定方法そのものから保証される。おまけとして、
//     成長が停滞しても最新世代のセルは常に前線であり続けるので、全世界が
//     休眠して二度と起きられなくなるデッドロックも構造的に起きない。
//   - 休眠の判定は bornAt (ノードの誕生時刻) だけを見る純関数で、RNG を
//     使わない。同じ state からは常に同じ休眠集合が出る = seed 決定的。
//   - 判定は dormancyCheckInterval tick ごとにだけ走る (毎tickの漸増コスト
//     にしない)。コストは O(ノード数 log ノード数 + エッジ数 + 実体化
//     チャンク数) で、総経過時間には比例しない。
//   - 休眠エッジも flux の通り道としては生き続ける (updateFlux は全エッジ
//     対象のまま)。凍結 (flux からも除外) にしなかったのは、母体 (source)
//     への供給路は必ず成熟領域を貫くため、そこを凍らせると前線の sink が
//     全て飢えて prune され、世界が壊死するから。flux は元々マルチソース
//     BFS 1回 O(V+E) で、実測ボトルネック (エッジ毎の場の読み書き) では
//     ない。
//   - 起床は3経路: (1) 前線が近づく = 次回判定で awake 側に入る (自動)、
//     (2) 成長が休眠セルへ届く = wakeCellAt (growth.ts が呼ぶ)、
//     (3) プレイヤーツール/栄養再生 = wakeDormantArea (web 側 M29-B が
//     ツール適用時に呼ぶ)。
//   - dormancyEvict=true なら、休眠が深い (awake セルから2セル以上離れた)
//     フィールドチャンクの実体を要約値へ圧縮して解放する (evictChunkAt)。
//     awake セル内の deposit/サンプリングは高々隣接チャンクまでしか届かない
//     (deposit 半径・growthStep ≪ セル一辺) ので、evict 直後に触れて即復元
//     される無駄は起きない。

import type { SimState, Vec2 } from '../types.js';
import type { Environment } from '../env/environment.js';
import type { ActivityFieldLike, BiomassFieldLike } from '../field/scalar-field.js';
import type { SimParams } from './params.js';
import type { NodeIndex } from './index-utils.js';

// セル座標を 1 個の整数キーへパックする。index-utils.ts の densityKey と
// 同じ発想だが、無限ワールドのセル座標 (worldSize 100,000 / セル 24 ≈
// ±4,200) を十分に覆えるようストライドを広げてある。
const CELL_STRIDE = 1 << 20;
const CELL_OFFSET = 1 << 19;

export function packDormancyCell(cx: number, cy: number): number {
  return (cx + CELL_OFFSET) * CELL_STRIDE + (cy + CELL_OFFSET);
}

/** ワールド座標が属する休眠セルのキー。life.ts/growth.ts のホットループが
 * 毎エッジ呼ぶので、床除算 + パックだけの軽さに保つこと。 */
export function dormancyCellKeyAt(x: number, y: number, cellWorld: number): number {
  return packDormancyCell(Math.floor(x / cellWorld), Math.floor(y / cellWorld));
}

/** 休眠機構が有効か。life.ts/growth.ts がループの外で一度だけ評価し、
 * 無効時はセルキー計算ごと省いて既存挙動と bit 一致を保つ。 */
export function dormantSetOf(state: SimState, params: SimParams): Set<number> | undefined {
  return params.dormancyCheckInterval > 0 ? state.dormantCells : undefined;
}

/** 成長が休眠セルへ踏み込んだときの即時起床 (growth.ts が新ノード生成時に
 * 呼ぶ)。次回判定を待つと新しいエッジが最大 checkInterval tick 凍るため。 */
export function wakeCellAt(state: SimState, params: SimParams, pos: Vec2): void {
  const d = state.dormantCells;
  if (!d || d.size === 0) return;
  d.delete(dormancyCellKeyAt(pos.x, pos.y, params.dormancyCellWorld));
}

/** プレイヤーツール/栄養再生などの外部イベントによる起床。pos を中心に
 * 半径 radius (ワールド単位) が触れるセルを休眠から外す。web 側 (M29-B) が
 * ツール適用時に呼ぶ想定。evict 済みフィールドチャンクの実体は、ツールの
 * 書き込み (place* → ensureChunk) が自動的に要約値から復元する。 */
export function wakeDormantArea(state: SimState, params: SimParams, pos: Vec2, radius = 0): void {
  const d = state.dormantCells;
  if (!d || d.size === 0) return;
  const cw = params.dormancyCellWorld;
  const x0 = Math.floor((pos.x - radius) / cw), x1 = Math.floor((pos.x + radius) / cw);
  const y0 = Math.floor((pos.y - radius) / cw), y1 = Math.floor((pos.y + radius) / cw);
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) d.delete(packDormancyCell(cx, cy));
  }
}

// 休眠判定と evict の本体。step.ts が dormancyCheckInterval tick ごとに呼ぶ。
export function updateDormancy(
  state: SimState, env: Environment, actField: ActivityFieldLike, bioField: BiomassFieldLike,
  params: SimParams, idx: NodeIndex,
): void {
  const cw = params.dormancyCellWorld;
  const margin = params.dormancyFrontierMargin;

  // 1. 前線アンカー = 最も新しく生まれたノードたちのセル (最大 K 個の相異なる
  //    セル)。bornAt 降順・同着は id 降順 — どちらも決定的な量なので、同じ
  //    state からは常に同じ前線が得られる。ソートは checkInterval ごとに
  //    1回だけの O(N log N)。
  const K = Math.max(1, params.dormancyFrontierCells);
  const byNewest = [...state.nodes].sort((a, b) => (b.bornAt - a.bornAt) || (b.id - a.id));
  const frontier = new Set<number>();
  for (const n of byNewest) {
    frontier.add(dormancyCellKeyAt(n.pos.x, n.pos.y, cw));
    if (frontier.size >= K) break;
  }

  // 2. 前線から margin セル以内 (Chebyshev) を「起きている」セルへ膨張する。
  //    前線がじわじわ近づいてきた休眠セルは、この膨張に入った時点で自動的に
  //    起床する (起床条件その1)。
  const awake = new Set<number>();
  for (const k of frontier) {
    const cy = (k % CELL_STRIDE) - CELL_OFFSET;
    const cx = Math.floor(k / CELL_STRIDE) - CELL_OFFSET;
    for (let dy = -margin; dy <= margin; dy++) {
      for (let dx = -margin; dx <= margin; dx++) awake.add(packDormancyCell(cx + dx, cy + dy));
    }
  }

  // 3. 休眠セル = ノードまたはエッジ中点が居るセルのうち awake でないもの。
  //    エッジ中点も拾うのは、セル境界をまたぐエッジ (中点セルにノードが無い)
  //    を判定漏れで永遠に起きたままにしないため。ここに無いセル (誰も居ない
  //    土地) は既定で「起きている」— 前線が新しい土地へ踏み出すのを妨げない。
  const dormant = new Set<number>();
  for (const n of state.nodes) {
    const k = dormancyCellKeyAt(n.pos.x, n.pos.y, cw);
    if (!awake.has(k)) dormant.add(k);
  }
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    const k = dormancyCellKeyAt((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, cw);
    if (!awake.has(k)) dormant.add(k);
  }
  state.dormantCells = dormant;

  // 4. evict: 実体化済みのフィールドチャンクのうち awake セルから Chebyshev
  //    距離 2 以上離れているものを、要約値 (平均) へ圧縮して解放する。
  //    「ノードが居るか」は問わない — 前線が通り過ぎたあと prune で誰も
  //    居なくなった土地のチャンクもここで回収する (これを漏らすと diffuse/
  //    decay の走査対象が総経過時間に比例して増え続ける — M25 実測の漸増)。
  if (!params.dormancyEvict) return;
  const farFromAwake = (x: number, y: number): boolean => {
    const cx = Math.floor(x / cw), cy = Math.floor(y / cw);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (awake.has(packDormancyCell(cx + dx, cy + dy))) return false;
      }
    }
    return true;
  };
  // env/actField/bioField のうち evict に対応する実装 (ChunkedGridEnvironment
  // / ChunkedScalarField) だけが optional メソッドを持つ。密な GridEnvironment
  // 等は持たないので何もしない (休眠を有効にしても有界ステージ構成で安全)。
  for (const t of [env, actField, bioField]) {
    if (!t.materializedChunkCenters || !t.evictChunkAt) continue;
    for (const c of t.materializedChunkCenters()) {
      if (farFromAwake(c.x, c.y)) t.evictChunkAt(c.x, c.y);
    }
  }
}
