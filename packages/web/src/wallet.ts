// M11: リソース経済。3種の通貨 (モックアップ①準拠):
//   🪙 しずく  — 基軸。ツール使用の主なコスト。
//   🍃 若葉    — デイリー/チャレンジ報酬。温度・毒素ツールのコスト。
//   🍄 胞子石  — 希少。実績解除・時代到達 (M14) の報酬。
//
// "やらなくても大丈夫" の哲学を壊さないことが最重要の設計制約: 🪙 は残高が
// 下限を割っていると時間経過で下限まで自動回復し、詰みを起こさない。
// コスト/報酬テーブルはここに一元化する。

export type CurrencyKind = 'sizuku' | 'wakaba' | 'horoishi';

export interface WalletBalances {
  sizuku: number;
  wakaba: number;
  horoishi: number;
}

export interface WalletEntry {
  at: string; // ISO
  currency: CurrencyKind;
  delta: number; // 正: 獲得, 負: 消費
  reason: string;
}

export interface ToolCost {
  currency: CurrencyKind;
  amount: number;
}

// ツール使用コスト表。未掲載のツール (light/erase) は無料。
export const TOOL_COSTS: Partial<Record<string, ToolCost>> = {
  food: { currency: 'sizuku', amount: 3 },
  water: { currency: 'sizuku', amount: 1 },
  drain: { currency: 'sizuku', amount: 1 },
  stone: { currency: 'sizuku', amount: 2 },
  heat: { currency: 'wakaba', amount: 2 },
  cool: { currency: 'wakaba', amount: 2 },
  toxin: { currency: 'wakaba', amount: 3 },
  // M31: 大局介入 (マクロツール、原野の俯瞰専用)。窓内ブラシの数十倍の
  // 価格帯 — 後半の主要な意思決定にする。最安の「雨季」は 🪙 の詰み防止
  // 下限 (SIZUKU_FLOOR=20) と同額: 残高が尽きても自動回復だけで必ずまた
  // 1つ買える (「やらなくても大丈夫」の詰み防止方針との整合)。
  rain: { currency: 'sizuku', amount: 20 },
  corridor: { currency: 'sizuku', amount: 60 },
  geoheat: { currency: 'wakaba', amount: 30 },
  geocool: { currency: 'wakaba', amount: 30 },
};

const START_BALANCES: WalletBalances = { sizuku: 120, wakaba: 20, horoishi: 0 };
// 🪙 の詰み防止用の下限と回復速度。
const SIZUKU_FLOOR = 20;
const SIZUKU_RECOVER_INTERVAL_MS = 4000;
const MAX_HISTORY = 50;
const STORAGE_KEY = 'morpho.wallet.v1';

interface StoredWallet {
  balances: WalletBalances;
  history: WalletEntry[];
}

export class Wallet {
  private balances: WalletBalances;
  private history: WalletEntry[];
  private lastRecoverAtMs: number;
  version = 0;

  constructor(nowMs = Date.now()) {
    const loaded = this.load();
    this.balances = loaded?.balances ?? { ...START_BALANCES };
    this.history = loaded?.history ?? [];
    this.lastRecoverAtMs = nowMs;
  }

  private load(): StoredWallet | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      const p = parsed as Partial<StoredWallet>;
      return {
        balances: { ...START_BALANCES, ...p.balances },
        history: Array.isArray(p.history) ? p.history : [],
      };
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ balances: this.balances, history: this.history }));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の残高は継続する)
    }
  }

  get(currency: CurrencyKind): number { return this.balances[currency]; }
  all(): WalletBalances { return { ...this.balances }; }
  historyList(): readonly WalletEntry[] { return this.history; }

  costOf(tool: string): ToolCost | null { return TOOL_COSTS[tool] ?? null; }

  canAfford(tool: string): boolean {
    const cost = TOOL_COSTS[tool];
    if (!cost) return true;
    return this.balances[cost.currency] >= cost.amount;
  }

  // canAfford() で確認済みの前提で呼ぶ (足りなければ何もせず false を返す)。
  spendForTool(tool: string): boolean {
    const cost = TOOL_COSTS[tool];
    if (!cost) return true;
    if (this.balances[cost.currency] < cost.amount) return false;
    this.balances[cost.currency] -= cost.amount;
    this.record(cost.currency, -cost.amount, `${tool} を使用`);
    this.save();
    return true;
  }

  // M31: コスト表以外の理由文字列で消費する入口 (マクロツールが
  // 「大局介入「雨季を呼ぶ」」のような日本語の理由を残すために使う)。
  // 足りなければ何もせず false。
  spend(currency: CurrencyKind, amount: number, reason: string): boolean {
    if (amount <= 0) return true;
    if (this.balances[currency] < amount) return false;
    this.balances[currency] -= amount;
    this.record(currency, -amount, reason);
    this.save();
    return true;
  }

  earn(currency: CurrencyKind, amount: number, reason: string): void {
    if (amount <= 0) return;
    this.balances[currency] += amount;
    this.record(currency, amount, reason);
    this.save();
  }

  private record(currency: CurrencyKind, delta: number, reason: string): void {
    this.history.push({ at: new Date().toISOString(), currency, delta, reason });
    while (this.history.length > MAX_HISTORY) this.history.shift();
    this.version++;
  }

  // 🪙 が下限を割っていたら、一定間隔ごとに1枚ずつ下限まで自動回復させる。
  // フレームごとに呼ぶ想定 (nowMs は主にテスト用の注入)。
  tickRecovery(nowMs = Date.now()): void {
    if (this.balances.sizuku >= SIZUKU_FLOOR) {
      this.lastRecoverAtMs = nowMs;
      return;
    }
    if (nowMs - this.lastRecoverAtMs < SIZUKU_RECOVER_INTERVAL_MS) return;
    this.balances.sizuku = Math.min(SIZUKU_FLOOR, this.balances.sizuku + 1);
    this.lastRecoverAtMs = nowMs;
    this.record('sizuku', 1, '自然回復');
    this.save();
  }
}
