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
