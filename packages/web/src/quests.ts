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
    id: 'explore-70',
    title: '大陸の70%を探索する',
    description: '個体を大きく広げて、皿の隅々まで行き渡らせよう',
    progress: (i) => i.traits.exploration / 0.7,
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
];

export function computeQuests(input: QuestInput): QuestStatus[] {
  return QUEST_DEFS.map((q) => {
    const progress = Math.max(0, Math.min(1, q.progress(input)));
    return { id: q.id, title: q.title, description: q.description, progress, done: progress >= 1 };
  });
}
