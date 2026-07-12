// メインクエスト (M4)。進捗は WorldInfo / Traits から導く純粋関数で、
// sim には状態を持ち込まない (アーキテクチャ方針: 個性/クエストは web 側で持つ)。

import type { Traits } from '@morpho/sim';

export interface QuestInput {
  coloniesReached: number;
  coloniesTotal: number;
  traits: Traits;
  // M6: 大マップに離れて配置したコロニーの総数と、現在の独立ネットワーク数。
  // 省略時 (=単一コロニー扱い) は常に達成済みとして扱う。
  sourceColonies?: number;
  connectedNetworks?: number;
  // M14: 大陸ステージ専用 (陸地セルのうち biomass 網が届いた比率, [0,1])。
  // 大陸以外のステージでも計算はされるが、クエストカードの表示は
  // stage.id === 'continent' のときだけ (UI 側でガードする)。
  landCoverage?: number;
  // M32: 原野専用。母体 (WILDLAND_CENTER) からの到達距離 (world unit) と、
  // 発見済みバイオーム数 [1,5]。他ステージでも計算はされるが (reachDistance は
  // 全ステージで計算する派生値、biomesDiscovered は原野以外では常に 0)、
  // クエストカードの表示は stage.id === 'wildland' のときだけ (UI 側でガードする)。
  reachDistance?: number;
  biomesDiscovered?: number;
}

export interface QuestStatus {
  id: string;
  title: string;
  description: string;
  progress: number; // [0,1]
  done: boolean;
}

interface QuestDef {
  id: string;
  title: string;
  description: string;
  progress(input: QuestInput): number;
}

// 大陸の探索度合いは traits.exploration (重心からの広がり、[0,1] 正規化) を
// そのまま「70% 目標」の分母に使う。M0 で定義されたまま HUD に出ていなかった
// 3軸スコアの exploration 軸を、ここで初めて意味のある指標として使う。
const QUEST_DEFS: QuestDef[] = [
  {
    id: 'connect-all',
    title: '拠点をすべてつなぐ',
    description: '皿に置かれたすべての拠点にネットワークを届けよう',
    progress: (i) => (i.coloniesTotal > 0 ? i.coloniesReached / i.coloniesTotal : 0),
  },
  {
    // M15.5: 実プレイ検証で exploration が初期状態からすでに 0.67 前後にあり
    // 旧閾値 0.7 は Day 1〜2 で達成されてしまうことが判明した (胞子期でも
    // トレイト自体は形状の広がりで決まるため)。exploration は長時間かけて
    // 0.85〜0.9 付近まで緩やかに伸びる指標なので、閾値を 0.85 へ引き上げて
    // 長期目標として機能させる。
    id: 'explore-70',
    title: '大陸の85%を探索する',
    description: '個体を大きく広げて、皿の隅々まで行き渡らせよう',
    progress: (i) => i.traits.exploration / 0.85,
  },
  {
    id: 'unite-colonies',
    title: '離れたコロニーをひとつに',
    description: '大マップに芽吹いた複数のコロニーを、ひとつのネットワークへ繋げよう',
    progress: (i) => {
      const total = i.sourceColonies ?? 1;
      const networks = i.connectedNetworks ?? 1;
      return total > 1 ? (total - networks) / (total - 1) : 1;
    },
  },
  {
    id: 'continent-nutrient',
    title: '大陸全体に栄養を届けよう',
    description: '水域を避けながら、陸地の隅々までネットワークを行き渡らせよう',
    progress: (i) => i.landCoverage ?? 0,
  },
  // M32: 原野専用。「拠点をすべてつなぐ (connect-all)」「大陸の85%を探索する
  // (explore-70)」は原野では意味を持たない (前者は開始直後から100%、後者は
  // 0%固定 — ROADMAP.md V9)。無限世界ならではの節目 (到達距離・発見バイオーム数)
  // に置き換えたメインクエストを、原野のときだけ UI 側で表示する。
  {
    id: 'wild-reach',
    title: '母体から500先へ到達しよう',
    description: '個体を伸ばし続けて、原野の果てまで踏み出そう',
    progress: (i) => (i.reachDistance ?? 0) / WILD_REACH_TARGET,
  },
  {
    id: 'wild-biomes',
    title: '3つのバイオームに根を張ろう',
    description: '母体の森を出て、違う土地の恵みを味わおう',
    progress: (i) => (i.biomesDiscovered ?? 0) / WILD_BIOMES_TARGET,
  },
];

// biomes.ts の DISTANCE_FULL (変異幅boostの飽和点) と同じ値を採用し、
// 「遠くまで行くほど良いことがある」を1つの数字で束ねる。
export const WILD_REACH_TARGET = 500;
export const WILD_BIOMES_TARGET = 3;

export function computeQuests(input: QuestInput): QuestStatus[] {
  return QUEST_DEFS.map((q) => {
    const progress = Math.max(0, Math.min(1, q.progress(input)));
    return { id: q.id, title: q.title, description: q.description, progress, done: progress >= 1 };
  });
}
