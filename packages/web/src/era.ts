// M14: 時代を「日数の関数」から「条件達成型」へ。
//   胞子期 → 拡散期: 最初の拠点接続
//   拡散期 → 変形体期: 拠点接続 n 個 + 総質量 x
//   変形体期 → 成熟期: 全 source ネットワーク統合 + 探索率 y%
// sim には持ち込まず、WorldInfo/Traits から導出する web 側の純粋関数
// (アーキテクチャ方針: 時代は web 側の派生量)。
//
// M15.5: 実プレイ検証で「皿ステージだと Day 2 で変形体期・Day 5 で成熟期に
// 達してしまい、時代が長期目標として機能しない」ことが判明した。原因は
// coloniesReached/massKg/exploration が sim の自然な成長で数日以内に
// 条件を満たしてしまうこと (これらの成長速度自体は sim 側でありここでは
// 変更できない)。そこで各遷移に「経過日数の下限」ゲートを追加し、
// 条件を満たしていても最短日数に達するまでは足止めする。
// 目標ペース (皿): 拡散期 = Day 8〜12、変形体期 = Day 20〜30、成熟期 = Day 40+。

export interface EraInput {
  coloniesReached: number;
  massKg: number;
  connectedNetworks: number;
  sourceColonies: number;
  exploration: number; // Traits.exploration [0,1]
  day: number; // M15.5: 経過日数 (tick / TICKS_PER_DAY)
}

export interface EraStatus {
  name: string;
  progress: number; // [0,1] 次の時代への到達率
}

export const DIFFUSE_COLONIES_REQUIRED = 1;
export const PLASMODIUM_COLONIES_REQUIRED = 2;
export const PLASMODIUM_MASS_KG_REQUIRED = 4;
export const MATURE_EXPLORATION_REQUIRED = 0.5;

// M15.5: 各時代への最短経過日数。条件を満たしていてもこれより早くは進まない。
export const DIFFUSE_MIN_DAY = 8;
export const PLASMODIUM_MIN_DAY = 20;
export const MATURE_MIN_DAY = 40;

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function networksUnified(input: EraInput): boolean {
  return input.sourceColonies <= 1 || input.connectedNetworks <= 1;
}

function dayProgress(day: number, minDay: number): number {
  return clamp01(day / minDay);
}

export function eraFor(input: EraInput): EraStatus {
  const matureConditionMet = networksUnified(input) && input.exploration >= MATURE_EXPLORATION_REQUIRED;
  if (matureConditionMet && input.day >= MATURE_MIN_DAY) {
    return { name: '成熟期', progress: 1 };
  }

  const plasmodiumConditionMet = input.coloniesReached >= PLASMODIUM_COLONIES_REQUIRED
    && input.massKg >= PLASMODIUM_MASS_KG_REQUIRED;
  if (plasmodiumConditionMet && input.day >= PLASMODIUM_MIN_DAY) {
    const netProgress = networksUnified(input)
      ? 1
      : clamp01((input.sourceColonies - input.connectedNetworks) / Math.max(1, input.sourceColonies - 1));
    const expProgress = clamp01(input.exploration / MATURE_EXPLORATION_REQUIRED);
    const dayP = dayProgress(input.day, MATURE_MIN_DAY);
    return { name: '変形体期', progress: clamp01(Math.min(dayP, (netProgress + expProgress) / 2)) };
  }

  const diffuseConditionMet = input.coloniesReached >= DIFFUSE_COLONIES_REQUIRED;
  if (diffuseConditionMet && input.day >= DIFFUSE_MIN_DAY) {
    const colonyProgress = clamp01(input.coloniesReached / PLASMODIUM_COLONIES_REQUIRED);
    const massProgress = clamp01(input.massKg / PLASMODIUM_MASS_KG_REQUIRED);
    const dayP = dayProgress(input.day, PLASMODIUM_MIN_DAY);
    return { name: '拡散期', progress: clamp01(Math.min(dayP, (colonyProgress + massProgress) / 2)) };
  }

  // 胞子期: 到達条件はもう満たしているが day ゲートで足止め中なら、
  // 残り日数の消化を進捗として見せる。まだ条件自体を満たしていなければ
  // 従来通り質量の伸びを早期の進捗の目安として使う。
  if (diffuseConditionMet) {
    return { name: '胞子期', progress: dayProgress(input.day, DIFFUSE_MIN_DAY) };
  }
  return { name: '胞子期', progress: clamp01(input.massKg / 0.3) };
}

// M27: ETA が「—」(見積もれないほど停滞) のときに出す、次の時代への残条件の
// 明示テキスト。eraFor() と同じ優先順位で「まだ満たしていない条件」を1つ選ぶ
// (day ゲートは他の条件を満たしていて初めて意味を持つので、条件そのものが
// 未達なら条件側を、条件は満たしているが日数待ちならそちらを優先する)。
export function describeEraBlocker(input: EraInput): string {
  const status = eraFor(input);
  if (status.name === '成熟期') return '';

  if (status.name === '変形体期') {
    if (!networksUnified(input)) return '条件: ネットワークをひとつに';
    if (input.exploration < MATURE_EXPLORATION_REQUIRED) return '条件: 個体をさらに広げる';
    return `条件: Day ${MATURE_MIN_DAY} まで経過`;
  }

  if (status.name === '拡散期') {
    if (input.coloniesReached < PLASMODIUM_COLONIES_REQUIRED) return '条件: もう1拠点に到達';
    if (input.massKg < PLASMODIUM_MASS_KG_REQUIRED) return '条件: 総質量を増やす';
    return `条件: Day ${PLASMODIUM_MIN_DAY} まで経過`;
  }

  // 胞子期
  if (input.coloniesReached < DIFFUSE_COLONIES_REQUIRED) return '条件: 最初の拠点に到達';
  return `条件: Day ${DIFFUSE_MIN_DAY} まで経過`;
}

// M16: 時代の残り時間予測「次の時代まで あと mm:ss」。
// EraStatus.progress を実時間軸でサンプリングした履歴から、進捗速度の
// EWMA (指数移動平均) を取り、残り距離をその速度で割って ETA (ミリ秒) を
// 推定する。sim の状態を一切見ない (main.ts が定期的にサンプルを積むだけ)
// 純粋関数なので、時代切替の検知やサンプリング頻度は呼び出し側の責務。
export interface EraSample {
  atMs: number;
  progress: number;
}

// 速度がこれ未満 (ほぼ停滞) なら ETA を出さず null (UI は「—」を表示する)。
const MIN_PROGRESS_RATE_PER_MS = 1e-7; // 相当に遅くても 1 か月以内なら出す下限

// M32: progress の値そのものを EMA (指数移動平均) で均す。原野は M30 の距離
// コスト勾配で「伸びた遠征枝が枯れて戻る」(= 到達距離/探索チャンクが一時的に
// 後退する) ことが仕様で、これをそのまま速度計算に外挿すると ETA が短時間で
// 「あと1分↔あと20分↔条件表示」と往復する (ROADMAP.md V9 実測)。EMA で
// 進捗の単発の揺れを均してから既存の速度推定にかけることで、後退/急伸1回分に
// 引っ張られにくくする。既存6ステージ (呼び出し側が smoothingAlpha を渡さない)
// の挙動は完全不変 — 引数を渡さないときは samples をそのまま使う元の計算になる。
function smoothProgress(samples: readonly EraSample[], alpha: number): EraSample[] {
  const out: EraSample[] = [];
  let smoothed = samples[0]!.progress;
  for (let i = 0; i < samples.length; i++) {
    smoothed = i === 0 ? samples[i]!.progress : smoothed + (samples[i]!.progress - smoothed) * alpha;
    out.push({ atMs: samples[i]!.atMs, progress: smoothed });
  }
  return out;
}

// M32: 原野の ETA 表示に使う平滑化係数 (ui.ts が渡す)。小さいほど強く均す。
export const WILDLAND_ERA_ETA_SMOOTHING_ALPHA = 0.25;

export function estimateEraEta(samples: readonly EraSample[], smoothingAlpha?: number): number | null {
  if (samples.length < 2) return null;
  const series = smoothingAlpha !== undefined && smoothingAlpha > 0 && smoothingAlpha < 1
    ? smoothProgress(samples, smoothingAlpha)
    : samples;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const dtMs = last.atMs - first.atMs;
  if (dtMs <= 0) return null;

  // EWMA: 直近のサンプル間隔ほど重みを大きくして進捗速度を推定する
  // (単純な先頭-末尾の平均速度だと、加速/減速中の変化に追従が遅れるため)。
  const ALPHA = 0.35;
  let rate: number | null = null;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    const dt = cur.atMs - prev.atMs;
    if (dt <= 0) continue;
    const instRate = (cur.progress - prev.progress) / dt;
    rate = rate === null ? instRate : rate * (1 - ALPHA) + instRate * ALPHA;
  }
  if (rate === null || rate < MIN_PROGRESS_RATE_PER_MS) return null;

  const remaining = 1 - last.progress;
  if (remaining <= 0) return 0;
  return remaining / rate;
}

// ── M32: 原野の時代 ──────────────────────────────────────
//
// 有界6ステージの eraFor() は「拠点数」ベースの条件 (もう1拠点に到達、等) を
// 使うが、原野には「拠点」という区切りが無く拡散期で構造的に止まってしまう
// (ROADMAP.md V9)。無限世界ならではの節目 — 到達距離 (母体からの直線距離)・
// 探索チャンク数・発見バイオーム数 — で刻み直す。世代数 (系統樹の採種チェーン)
// は「原野を継続して遊んだ回数」を表すが、1回のプレイ内 (checkEraTransition
// が監視する1セッション) では変化しない定数になってしまい、時代が「進む」条件
// としては機能しない (むしろ図鑑の special:gen3・biomes.ts の変異幅boost で
// 既に活躍している) ため、ここでは採用しない。
// day ゲートは有界6ステージと同じ考え方 (条件を満たしていても最短日数まで
// 足止め) だが、原野は M31 の発芽ラッチで序盤の伸びが控えめなため、
// 各段の最短日数は有界6ステージより緩めに取る。
export interface WildlandEraInput {
  reachDistance: number;   // 母体 (WILDLAND_CENTER) からの到達距離 (world unit)
  exploredChunks: number;  // 探索チャンク数 (touched の累計)
  biomesDiscovered: number; // 発見済みバイオーム数 [1,5] (母体の森を含む)
  day: number;
}

// 母体の森 (Chebyshev 1チャンク以内 = 3×3) の外縁に相当する到達距離の目安
// (WILDLAND_CHUNK_CELLS=48 × 1.5 チャンクぶん)。
export const WILDLAND_DIFFUSE_REACH_REQUIRED = 70;
// 初期窓が焼き込む 3×3 = 9 チャンクより明確に広く踏破したかどうかの目安。
export const WILDLAND_DIFFUSE_CHUNKS_REQUIRED = 16;
export const WILDLAND_PLASMODIUM_CHUNKS_REQUIRED = 40;
export const WILDLAND_PLASMODIUM_BIOMES_REQUIRED = 2; // 森以外を1種以上発見
export const WILDLAND_MATURE_REACH_REQUIRED = 300; // biomes.ts DISTANCE_FULL(500) の6割程度
export const WILDLAND_MATURE_BIOMES_REQUIRED = 4; // 5種中4種 (森含む) を発見

export const WILDLAND_DIFFUSE_MIN_DAY = 3;
export const WILDLAND_PLASMODIUM_MIN_DAY = 15;
export const WILDLAND_MATURE_MIN_DAY = 35;

function wildlandDiffuseConditionMet(input: WildlandEraInput): boolean {
  return input.reachDistance >= WILDLAND_DIFFUSE_REACH_REQUIRED
    || input.exploredChunks >= WILDLAND_DIFFUSE_CHUNKS_REQUIRED;
}
function wildlandPlasmodiumConditionMet(input: WildlandEraInput): boolean {
  return input.exploredChunks >= WILDLAND_PLASMODIUM_CHUNKS_REQUIRED
    && input.biomesDiscovered >= WILDLAND_PLASMODIUM_BIOMES_REQUIRED;
}
function wildlandMatureConditionMet(input: WildlandEraInput): boolean {
  return input.reachDistance >= WILDLAND_MATURE_REACH_REQUIRED
    && input.biomesDiscovered >= WILDLAND_MATURE_BIOMES_REQUIRED;
}

export function wildlandEraFor(input: WildlandEraInput): EraStatus {
  if (wildlandMatureConditionMet(input) && input.day >= WILDLAND_MATURE_MIN_DAY) {
    return { name: '成熟期', progress: 1 };
  }

  if (wildlandPlasmodiumConditionMet(input) && input.day >= WILDLAND_PLASMODIUM_MIN_DAY) {
    const reachP = clamp01(input.reachDistance / WILDLAND_MATURE_REACH_REQUIRED);
    const biomeP = clamp01(input.biomesDiscovered / WILDLAND_MATURE_BIOMES_REQUIRED);
    const dayP = dayProgress(input.day, WILDLAND_MATURE_MIN_DAY);
    return { name: '変形体期', progress: clamp01(Math.min(dayP, (reachP + biomeP) / 2)) };
  }

  if (wildlandDiffuseConditionMet(input) && input.day >= WILDLAND_DIFFUSE_MIN_DAY) {
    const chunkP = clamp01(input.exploredChunks / WILDLAND_PLASMODIUM_CHUNKS_REQUIRED);
    const biomeP = clamp01(input.biomesDiscovered / WILDLAND_PLASMODIUM_BIOMES_REQUIRED);
    const dayP = dayProgress(input.day, WILDLAND_PLASMODIUM_MIN_DAY);
    return { name: '拡散期', progress: clamp01(Math.min(dayP, (chunkP + biomeP) / 2)) };
  }

  // 胞子期: 母体の森を出る条件はもう満たしているが day ゲートで足止め中なら
  // 残り日数の消化を進捗として見せる。まだ条件自体を満たしていなければ、
  // 到達距離/探索チャンクの伸びを早期の進捗の目安として使う。
  if (wildlandDiffuseConditionMet(input)) {
    return { name: '胞子期', progress: dayProgress(input.day, WILDLAND_DIFFUSE_MIN_DAY) };
  }
  const reachP = input.reachDistance / WILDLAND_DIFFUSE_REACH_REQUIRED;
  const chunkP = input.exploredChunks / WILDLAND_DIFFUSE_CHUNKS_REQUIRED;
  return { name: '胞子期', progress: clamp01(Math.max(reachP, chunkP)) };
}

// M32: describeEraBlocker() の原野版。eraFor/describeEraBlocker と同じ
// 優先順位で「まだ満たしていない条件」を1つ選ぶ。
export function describeWildlandEraBlocker(input: WildlandEraInput): string {
  const status = wildlandEraFor(input);
  if (status.name === '成熟期') return '';

  if (status.name === '変形体期') {
    if (input.reachDistance < WILDLAND_MATURE_REACH_REQUIRED) return '条件: さらに遠くまで到達';
    if (input.biomesDiscovered < WILDLAND_MATURE_BIOMES_REQUIRED) return '条件: 別のバイオームを見つける';
    return `条件: Day ${WILDLAND_MATURE_MIN_DAY} まで経過`;
  }

  if (status.name === '拡散期') {
    if (input.exploredChunks < WILDLAND_PLASMODIUM_CHUNKS_REQUIRED) return '条件: さらに広く探索する';
    if (input.biomesDiscovered < WILDLAND_PLASMODIUM_BIOMES_REQUIRED) return '条件: 別のバイオームを見つける';
    return `条件: Day ${WILDLAND_PLASMODIUM_MIN_DAY} まで経過`;
  }

  // 胞子期
  if (!wildlandDiffuseConditionMet(input)) return '条件: 母体の森の外へ';
  return `条件: Day ${WILDLAND_DIFFUSE_MIN_DAY} まで経過`;
}
