// M15: 初回起動時だけのオンボーディング。「環境を整える (あなた) →
// 委ねる (いのちのふるまい) → 変化を観察する (発見と気づき)」の3ステップを
// コーチマークで案内する。純粋関数 + localStorage の薄いラッパーのみで、
// DOM 操作は main.ts 側が行う (アーキテクチャ方針: ゲームロジックは純粋関数)。

const STORAGE_KEY = 'morpho.onboarded.v1';

export interface OnboardingStep {
  title: string;
  body: string;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  { title: '① 環境を整える (あなた)', body: 'エサ・水・光などのツールで、粘菌が育つ土地を用意しよう。' },
  { title: '② 委ねる (いのちのふるまい)', body: '「観察をはじめる」を押したら、あとは粘菌が自分の意思で伸び広がっていくのを見守るだけ。' },
  { title: '③ 変化を観察する (発見と気づき)', body: '一日ごとに結果を受け取り、個性・図鑑・系統樹の発見を楽しもう。' },
];

export function hasSeenOnboarding(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return storage.getItem(STORAGE_KEY) === '1';
}

export function markOnboardingSeen(storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(STORAGE_KEY, '1');
}

// M32: 「皿 (チュートリアル) → 原野 (本編)」の推奨動線。皿の成熟期到達を
// 「本編を勧めるタイミング」として使う (ROADMAP.md M32)。一度出したら
// (原野へ移動した/閉じたのどちらでも) 二度と出さない — 既にプレイ済みの人に
// 毎回同じ案内を出すのはノイズになるため。純粋関数として切り出し、
// main.ts が毎フレーム呼んでも DOM/localStorage を汚さない (呼び出し側が
// markWildlandSuggestionSeen() を1回呼ぶまでは何度呼んでも同じ判定を返す)。

const WILDLAND_SUGGEST_KEY = 'morpho.wildlandSuggested.v1';

export function hasSeenWildlandSuggestion(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return storage.getItem(WILDLAND_SUGGEST_KEY) === '1';
}

export function markWildlandSuggestionSeen(storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(WILDLAND_SUGGEST_KEY, '1');
}

// stageId: 現在のステージ。eraName: 現在の時代名。alreadySuggested: この
// セッションまたは過去のセッションで既に案内済みか (hasSeenWildlandSuggestion
// の結果を渡す)。「皿で成熟期に到達し、まだ案内していない」ときだけ true。
// 原野そのものや、皿以外の有界ステージでは出さない (皿 = チュートリアルの
// ゴールとして原野を勧める、という導線を明確に保つ)。
export function shouldSuggestWildland(stageId: string, eraName: string, alreadySuggested: boolean): boolean {
  return !alreadySuggested && stageId === 'petri' && eraName === '成熟期';
}
