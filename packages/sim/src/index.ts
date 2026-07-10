// 基本型
export * from './types.js';
export * from './rng.js';

// 低レイヤの場ヘルパ
export * from './field/grid.js';
export * from './field/scalar-field.js';
// M25: 半無限ワールド向けのチャンク化フィールド (既存ステージは未使用)。
export * from './field/chunk-grid.js';
// M25: ActivityField/BiomassField のチャンク版 (既存ステージは未使用)。
export * from './field/chunked-scalar-field.js';

// 静的な土地 + 動的な場 (活動 / 体)
export * from './env/environment.js';
export * from './env/activity-field.js';
export * from './env/biomass-field.js';
// M25: 半無限ワールド向けのチャンク化 Environment (既存ステージは未使用)。
export * from './env/chunked-environment.js';
// M25: チャンク化ワールドを既存の GridEnvironment 描画経路へ橋渡しする窓アダプタ。
export * from './env/chunk-window.js';

// イベント
export * from './events/bus.js';

// グラフ系シミュレーション
export * from './graph/params.js';
export * from './graph/init.js';
export * from './graph/traits.js';
export * from './graph/genome.js';
export * from './graph/individuality.js';
export * from './graph/step.js';
// M29: 成熟領域の休眠 (起床 API は web 側のツール配線 M29-B が使う)。
export * from './graph/dormancy.js';

// 膜系シミュレーション (graph とは独立した別モデル)
export * from './membrane/membrane.js';
