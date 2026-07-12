// M31: 見守り収入。見守りモード (連続再生) には収入が一切なく、原野を
// 何日見守っても雫が増えない問題 (ROADMAP.md V8) への対応。
// 「世界の成長」に比例するイベント駆動の収入を原野に入れる:
//
//   - 新チャンク到達  … 🪙 (探索チャンク数 = touched の累計が増えた分)
//   - 新バイオーム発見 … 🍃 (訪問済みチャンクのバイオーム種が初めて現れた)
//   - 日次の基本給     … 🪙 (見守りモードのみ。デイループの日次収入
//                        `10+growthBonus` (main.ts) より控えめな固定額)
//   - 時代到達         … 🍄 (既存の main.ts の時代報酬をそのまま使う —
//                        ここでは扱わない)
//
// 二重付与の防ぎ方:
//   - 日次の基本給は「見守りモード中に日境界を跨いだとき」だけ払う。
//     デイループの日次収入 (showDayResult) は「デイループモード中に日を
//     消化したとき」だけ払われる。1つの日境界はどちらか一方のモードでしか
//     跨げないので、同じ日に両方が付くことはない (モードを切り替えても、
//     lastDay の同期だけが進み支払いはスキップされる)。
//   - 新チャンク/新バイオームは他のどの報酬とも重複しない新設イベント。
//     セッション開始時の初期値 (開始時に踏む 3×3 チャンクと母体の森) は
//     ベースライン化して支払わない。
//
// このモジュールは純粋 (DOM も Wallet も触らない): update() が「今回付与
// すべき収入イベントの一覧」を返し、main.ts が wallet.earn へ流す。

import type { CurrencyKind } from './wallet.js';
import { BIOME_LABEL, type BiomeId } from './biomes.js';
import { wildlandBiomeAt } from './stages.js';

// 収入テーブル (M31)。デイループの日次収入が 10+growthBonus (main.ts) なので、
// 見守りの基本給はそれより控えめな固定 6。新チャンクは1枚 2 (Day 100 で
// 累計 約130枚 = 生涯 約260 と、ツール数十回ぶんの規模に収まる)。
// 新バイオームは全5種しか無い希少イベントなので 🍃 をまとめて贈る。
export const WATCH_DAILY_SIZUKU = 6;
export const CHUNK_REACH_SIZUKU = 2;
export const BIOME_DISCOVERY_WAKABA = 10;

export interface IncomeEvent {
  currency: CurrencyKind;
  amount: number;
  reason: string;
}

export interface WatchIncomeInput {
  stageId: string;
  day: number;
  /** 見守りモード (= デイループモードでない) か。 */
  watchMode: boolean;
  /** 探索チャンク数 (touched の累計、単調非減少)。 */
  exploredChunks: number;
  /** 訪問済みチャンクの番地一覧 (worldOverview.chunks)。未着なら null。 */
  chunkCoords: readonly { cx: number; cy: number }[] | null;
  worldSeed: number;
}

export class WatchIncomeTracker {
  private lastStageId: string | null = null;
  private lastDay = 0;
  private lastChunks: number | null = null;
  private seenBiomes: Set<BiomeId> | null = null;
  private lastChunkCoordsRef: unknown = null;

  // セッションの切れ目 (リセット / ステージ切替 / 系統からの再開) で呼ぶ。
  // ベースラインを取り直し、新セッションの初期状態に支払わないようにする。
  reset(): void {
    this.lastStageId = null;
    this.lastDay = 0;
    this.lastChunks = null;
    this.seenBiomes = null;
    this.lastChunkCoordsRef = null;
  }

  // 毎フレーム呼ぶ。今回付与すべき収入イベントを返す (無ければ空配列)。
  update(input: WatchIncomeInput): IncomeEvent[] {
    // ステージが変わっていたら (reset() の呼び忘れ・経路漏れに対する防御)
    // ベースラインを取り直す。
    if (this.lastStageId !== input.stageId) {
      this.reset();
      this.lastStageId = input.stageId;
      this.lastDay = input.day;
    }
    // 見守り収入は原野のみ (有界6ステージは完成品として経済も凍結する —
    // ROADMAP.md のアーキテクチャ方針)。lastDay だけは同期し続ける。
    if (input.stageId !== 'wildland') {
      this.lastDay = input.day;
      return [];
    }

    const events: IncomeEvent[] = [];

    // 日次の基本給 (見守りモードのみ。二重付与の防ぎ方は冒頭コメント)。
    if (input.day > this.lastDay) {
      const days = input.day - this.lastDay;
      if (input.watchMode) {
        events.push({
          currency: 'sizuku',
          amount: WATCH_DAILY_SIZUKU * days,
          reason: days === 1 ? `Day ${this.lastDay} を見守った` : `Day ${this.lastDay}〜${input.day - 1} を見守った`,
        });
      }
      this.lastDay = input.day;
    }

    // 新チャンク到達。初回観測はベースライン (開始時の 3×3 に払わない)。
    if (this.lastChunks === null) {
      this.lastChunks = input.exploredChunks;
    } else if (input.exploredChunks > this.lastChunks) {
      const n = input.exploredChunks - this.lastChunks;
      this.lastChunks = input.exploredChunks;
      events.push({
        currency: 'sizuku',
        amount: CHUNK_REACH_SIZUKU * n,
        reason: n === 1 ? '新しい土地に到達' : `新しい土地に到達 (${n}チャンク)`,
      });
    }

    // 新バイオーム発見。俯瞰 (chunkCoords) が届いたときだけ、参照が変わった
    // とき (≈1秒に1回) に走査する。初回観測はベースライン (開始時に見えて
    // いる母体の森などに払わない)。
    if (input.chunkCoords && input.chunkCoords !== this.lastChunkCoordsRef) {
      this.lastChunkCoordsRef = input.chunkCoords;
      const isBaseline = this.seenBiomes === null;
      const seen = (this.seenBiomes ??= new Set<BiomeId>());
      for (const c of input.chunkCoords) {
        const biome = wildlandBiomeAt(c.cx, c.cy, input.worldSeed);
        if (seen.has(biome)) continue;
        seen.add(biome);
        if (!isBaseline) {
          events.push({
            currency: 'wakaba',
            amount: BIOME_DISCOVERY_WAKABA,
            reason: `新しいバイオーム「${BIOME_LABEL[biome]}」を発見`,
          });
        }
      }
    }

    return events;
  }
}
