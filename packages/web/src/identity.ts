// M12: 個体の同定。「ねばりのこ #n」の通し番号をリセット/世代交代のたびに
// 発番し、個体ビュー・図鑑・系統樹・アルバムのキャプションで同じ名前を使う。
// リネーム可 (個体ビューの名前をタップで編集)。

const STORAGE_KEY = 'morpho.identity.v1';

interface IdentityState {
  nextNumber: number;
  currentNumber: number;
  customName: string | null;
}

function freshState(): IdentityState {
  return { nextNumber: 2, currentNumber: 1, customName: null };
}

export class Identity {
  private state: IdentityState;
  version = 0;

  constructor() {
    this.state = this.load() ?? freshState();
  }

  private load(): IdentityState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<IdentityState> | null;
      if (!parsed || typeof parsed.nextNumber !== 'number' || typeof parsed.currentNumber !== 'number') return null;
      return { nextNumber: parsed.nextNumber, currentNumber: parsed.currentNumber, customName: parsed.customName ?? null };
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の状態は継続する)
    }
  }

  currentNumber(): number { return this.state.currentNumber; }

  name(): string {
    return this.state.customName ?? `ねばりのこ #${this.state.currentNumber}`;
  }

  rename(name: string): void {
    const trimmed = name.trim();
    this.state.customName = trimmed.length > 0 ? trimmed.slice(0, 24) : null;
    this.version++;
    this.save();
  }

  // 新しい個体が始まるたび (reset/ステージ切替/世代交代) に呼ぶ。
  // 通し番号は全プレイ履歴を通じて増え続ける (世代交代でリセットしない)。
  advance(): void {
    this.state.currentNumber = this.state.nextNumber;
    this.state.nextNumber += 1;
    this.state.customName = null;
    this.version++;
    this.save();
  }
}
