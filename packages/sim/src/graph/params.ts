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

  // ── 休眠 (dormancy, M29 無限ワールド用) ──
  // 前線から遠く構造変化が止まった領域を、チャンク相当の空間セル単位で
  // 「休眠」させる: 休眠セル内のエッジは activity/fatigue/radius 更新と
  // Activity/Biomass フィールドへの deposit をスキップし、輸送 (flux) の
  // 通り道としてだけ生き続ける。growth (reclaim 含む) も休眠セルのノードを
  // 触らない。判定は bornAt (構造の変化) だけの純関数で RNG を使わないため
  // seed 決定的。dormancyCheckInterval=0 (既定) で全機構が無効 = 既存
  // 6ステージは bit 一致で不変 (M25 の forageReclaimThreshold 方式)。
  dormancyCheckInterval: number;  // N tick ごとに休眠判定を行う。0 = 無効 (既定)
  dormancyCellWorld: number;      // 休眠セルの一辺 (ワールド単位)。フィールドのチャンク一辺と揃えると evict がセルと 1:1 に対応する
  dormancyFrontierCells: number;  // 前線として起きていられるセル数の上限 (最も新しく生まれたノードのセルから数える)
  dormancyFrontierMargin: number; // 前線セルから Chebyshev 距離でこのセル数以内は起きたまま (起床の余白)
  dormancyEvict: boolean;         // 休眠チャンクのフィールド実体を要約値 (平均) へ圧縮して解放する (対応実装がある場合のみ)

  // ── 距離のコスト勾配 (M30 無限ワールド用) ──
  // 「母体から近い組織は消費が緩やか、遠征している組織は早く消耗する」
  // (ROADMAP ビジョン第4項)。母体からの距離が h のエッジは、fatigue の増分が
  // (1 + distanceUpkeep×h) 倍、流れによる回復が 1/(1 + distanceUpkeep×h) 倍に
  // なる — 効果は連続的で、母体近傍 (h が小さい) では実質ゼロ。伸びすぎた
  // 遠征枝は疲労が回復で追いつかなくなり、activity と radius が落ちて自然に
  // 枯れて戻る (無制限な一方向暴走への自然なブレーキ)。
  // 距離 h の定義は distanceMode で選ぶ:
  //   - 'hops' (既定、M30-A): 母体 (source ノード) からのグラフ距離 (hop 数)。
  //     flux が毎tick回しているマルチソース BFS (flux.ts) に distanceUpdate-
  //     Interval tick ごとに便乗して hop 深さを記録する (二重計算なし)。
  //     forager reclaim (M25) で母体から切り離された孤立成分には載らない
  //     (= 距離コストが効くのは連結コアのみ) という既知の限界がある。
  //   - 'origin' (M30-B): 原点 (createInitialState/seedSource 時点の初期 source
  //     位置。複数なら最寄り) からのユークリッド距離 (ワールド単位)。孤立
  //     成分にも等しく効き、ビジョンの文言 (スタート位置からの空間距離) に
  //     一致する。1 hop ≈ growthStep (数ワールド単位) なので、distanceUpkeep
  //     は 'hops' の推奨値 (0.005/hop) を growthStep で割った程度 (≈0.0015/unit)
  //     へ再スケールすること。
  // どちらも距離キャッシュは state.sourceHops (RNG 不使用 = seed 決定的)。
  // distanceUpkeep=0 (既定) で無効 = 既存6ステージは bit 一致で不変
  // (forageReclaimThreshold 方式)。
  distanceUpkeep: number;         // 距離単位あたりの維持係数。0 = 無効 (既定)
  distanceUpdateInterval: number; // 距離キャッシュを更新する間隔 (tick)。distanceUpkeep=0 なら参照されない
  distanceMode: 'hops' | 'origin'; // 距離の定義。'hops' = グラフ距離 (既定)、'origin' = 原点からのユークリッド距離

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

  // 休眠は既定で無効 (checkInterval=0)。他の値は有効化時の推奨初期値で、
  // 無効時は一切参照されない (既存6ステージは bit 一致で不変)。
  dormancyCheckInterval: 0,
  dormancyCellWorld: 24,     // 原野のチャンク一辺 (48) の半分 = 1チャンクが 2×2 セルに整数分割される (M29-B 実測で 48 より速く span 同等)
  dormancyFrontierCells: 4,  // 実測 (docs/playtest-2026-07-09-infinite/sim-100day-dormancy.txt) で span を維持しつつチャンク数が頭打ちになった値
  dormancyFrontierMargin: 1,
  dormancyEvict: false,

  // 距離のコスト勾配は既定で無効 (0)。interval は有効化時の推奨値で、
  // 無効時は一切参照されない。60 = 休眠判定と同じ低頻度 (距離は growth が
  // 12 tick ごとに数 hop しか動かさないので、60 tick の遅れは十分小さい)。
  distanceUpkeep: 0,
  distanceUpdateInterval: 60,
  distanceMode: 'hops',

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
