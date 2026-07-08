// グラフ系シミュレーションのチューニング項目。
// 規模が大きいので、何の何に効く係数か分かるよう category 別に並べる。

export interface SimParams {
  // ── 構造 / 幾何 ────────────────────
  growthStep: number;          // 1 回の伸長距離
  candidateCount: number;      // 1 tip あたり何方向を試すか
  candidateSpreadBase: number; // 候補のばらつき角 (rad)。stress で広がる
  mergeRadius: number;         // 近接ノードへの接続しきい値
  worldMargin: number;         // 端への到達禁止帯
  initialRadius: number;       // 新エッジの太さ
  pruneRadius: number;         // この太さ未満で flux<0.1 なら枯死
  maxDegree: number;           // 1 ノードの最大次数
  sourceInitialBranches: number;

  // ── 流量 (flux) ───────────────────
  fluxDecay: number;           // 1 tick の残存率
  fluxSupply: number;          // sink→source 最短経路に流す
  fluxNormalize: number;       // [0,1] に正規化する際の基準値

  // ── activity / fatigue / stress の重み ──
  wFlux: number;
  wNutrient: number;
  wFatigue: number;
  wCrowding: number;
  wActivityField: number;
  fatigueGrow: number;         // 活動 1 tick あたりの fatigue 増分
  fatigueRecover: number;      // 流れによる回復
  stressGrow: number;          // 伸長失敗で増分 (現在は未使用、将来の hook)
  stressRelief: number;        // 分岐成功で軽減
  stressBranchThreshold: number;

  // ── 成長判定 ────────────────────────
  growthActivityThreshold: number;
  growthProbability: number;
  branchActivityThreshold: number;
  branchProbabilityBase: number;
  alpha: number;               // radius の成長係数
  beta: number;                // radius の減衰係数

  // ── 再採餌 (forager, 無限ワールド用) ──
  // sink は本来「食料に到達した終端」で二度と伸びない。局所の栄養がこの値
  // 未満まで枯れた sink を relay (前線チップ) へ戻し、次の餌場へ這い出させる。
  // 0 (既定) で無効 = 既存ステージは完全に不変。無限ステージ (原野) だけが
  // 正の値を入れて「前線が尽きない」forager ループを成立させる (ROADMAP M25)。
  forageReclaimThreshold: number;

  // ── 環境スコア ──────────────────────
  foodReachThreshold: number;
  nutrientBias: number;
  moistureBias: number;
  brightnessPenalty: number;
  obstaclePenalty: number;
  gradientBias: number;
  noiseAmount: number;

  // ── 温度 / 毒素 (M10) ────────────────
  tempOptimal: number;    // 最適温度 (GridEnvironment の温度場と同じ 0..1 目安のスケール)
  tempTolerance: number;  // この範囲内なら成長への影響はほぼない。外れるほど活動の回復と成長確率が落ちる
  toxinPenalty: number;   // 毒素濃度が activity と成長候補の評価に与えるペナルティの重み (通過は妨げない)

  // ── Activity Field ─────────────────
  activityDeposit: number;
  activityFieldDecay: number;
  activityFieldDiffusion: number;

  // ── Biomass Field (膜らしさの主体) ──
  biomassDeposit: number;
  biomassRadius: number;
  biomassDecay: number;
  biomassDiffusion: number;
  wBiomassGradient: number;
  lateralBudBiomassThreshold: number;
  lateralBudProbability: number;
}

export const DEFAULT_PARAMS: SimParams = {
  growthStep: 3.0,
  candidateCount: 5,
  candidateSpreadBase: 0.8,
  mergeRadius: 1.8,
  worldMargin: 1.0,
  initialRadius: 0.7,
  pruneRadius: 0.35,
  maxDegree: 5,
  sourceInitialBranches: 6,

  fluxDecay: 0.85,
  fluxSupply: 5.0,
  fluxNormalize: 5.0,

  wFlux: 0.6,
  wNutrient: 0.3,
  wFatigue: 0.2,
  wCrowding: 0.3,
  wActivityField: 0.35,
  fatigueGrow: 0.015,
  fatigueRecover: 0.020,
  stressGrow: 0.04,
  stressRelief: 0.5,
  stressBranchThreshold: 0.15,

  growthActivityThreshold: 0.35,
  growthProbability: 0.6,
  branchActivityThreshold: 0.5,
  branchProbabilityBase: 0.04,
  alpha: 0.30,
  beta: 0.06,
  forageReclaimThreshold: 0, // 既定は無効 (既存ステージは sink を戻さない)

  foodReachThreshold: 0.55,
  nutrientBias: 2.5,
  moistureBias: 0.5,
  brightnessPenalty: 0.4,
  obstaclePenalty: 2.0,
  gradientBias: 0.6,
  noiseAmount: 0.1,

  // GridEnvironment の既定 baseTemperature (0.5) と揃えてあるので、
  // ツールで温度を動かさない限り成長には影響しない。
  tempOptimal: 0.5,
  tempTolerance: 0.35,
  toxinPenalty: 0.6,

  activityDeposit: 0.15,
  activityFieldDecay: 0.04,
  activityFieldDiffusion: 0.18,

  biomassDeposit: 0.18,
  biomassRadius: 2.6,
  biomassDecay: 0.012,
  biomassDiffusion: 0.05,
  wBiomassGradient: 0.55,
  lateralBudBiomassThreshold: 0.9,
  lateralBudProbability: 0.18,
};
