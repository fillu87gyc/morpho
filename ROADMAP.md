# モルフォ — Web ゲーム化ロードマップ

> 「制御する」のではなく、「条件を整え、振る舞いを引き出す」。
> モックアップで描いた粘菌育成体験へ、既存の `@morpho/sim` を段階的に拡張する計画。

## 現在地

- **`@morpho/sim`** — 粘菌のローカル則 (グラフ成長 / Biomass膜 / Activity場 / 環境ツール) は完成済み。Node から PNG を吐く `scripts/render.ts` で挙動確認可能。
- **`@morpho/web`** (本リリースで新設) — `@morpho/sim` を `<canvas>` に貼り、最小の HUD とツールパレットで「触って育てる」素体ができた状態。

## マイルストーン

### M0 — 動かす土台 (本PR)
- [x] `packages/web` を Vite + TypeScript で作成
- [x] PNG レンダラーを Canvas に移植 (食料 / 障害物 / Biomass膜 / 管 / ノード)
- [x] 再生 / 一時停止 / 再生速度スライダー (×1〜×24 を連続可変)
- [x] ツールパレット: エサ / 光 / 水 / 石 / 削除 (クリック & ドラッグ)
- [x] HUD: 日数、3軸スコア (探索 / 効率 / 安定)、ノード/エッジ数、簡易環境バランス
- [x] リセット (シード再設定)
- [x] CI に web typecheck を追加

### M1 — 「観察する」を気持ちよくする
- [x] BiomassField の差分のみを再描画 (60fps 安定 / モバイル可)
- [ ] WebGL2 or `OffscreenCanvas` バックエンド (希望者向け)
- [x] Web Worker でシミュレーションを分離 (UI 操作を止めない)
- [x] スナップショット採取: Day 1 / 5 / 10 ... を縮小サムネで成長タイムラインに表示
- [x] 環境ヒートマップ表示の ON/OFF (栄養 / 水 / 光)
- [x] カメラのズーム / パン (ホイールでズーム、右ドラッグで移動、ダブルクリック/ボタンで全体表示に戻す)
  - モバイルのピンチズームは M7 で別途対応

### M1.5 — 皿を「土地」にする
- [x] 起動時にバイオード (岩場 / 砂地 / 草地 / 水場 / 陽だまり) をシードから手続き的に生成
  - `Environment.placeX()` だけを使って web 側で生成 (sim 本体は変更なし)
  - ヒート表示 OFF でも分かるよう、常時の控えめな地形テクスチャを追加

### M2 — ねばりのこに「個性」を持たせる
- [x] Source ごとの遺伝パラメータ (mergeRadius / branchProb / 嗜好) を内部に持たせる
  - `graph/genome.ts`: seed から決定的に `Genome` を生成し、`applyGenome()` で SimParams に乗算適用
- [x] その個体に育ったときのトレイト測定 → 「太くつなぐ型」「広がり型」「効率型」などのタイプ判定
  - `graph/individuality.ts`: `computeIndividuality()` (6軸) + `classifyIndividual()` (5タイプ判定)
- [x] 図鑑データ構造とローカルストレージ保存
  - `web/src/encyclopedia.ts`: `Encyclopedia` クラスが発見済みタイプを localStorage に永続化
- [x] 「個体ビュー」パネル: 健康度 / 活力 / 探索性 / 効率性 / 安定性 / 適応性
  - 左ペインの「個体ビュー」カードにタイプ表示 + 6軸バーを追加

### M3 — 環境に物語を
- [x] 複数のステージ (洞窟 / 砂漠 / 都市跡 / 湿地)
  - `web/src/stages.ts`: `StageConfig` (地形生成関数 / baseMoisture・baseBrightness / SimParams 上書き / 自然減衰速度) を5種類定義し、HUD の「ステージ」セレクトで切り替える
  - 洞窟: 暗い (`brightnessPenalty: 0` で光ペナルティ無効)、湿度高 (`baseMoisture` 高)
  - 砂漠: 蒸発が早い (`moistureRelaxPerTick` 高)、エサ希少 (`foodAmountMultiplier` 低)
  - 都市跡: 建物基礎の矩形テンプレート (`placeRuinTemplate`) + ランダムな瓦礫配置
  - 湿地: 水・栄養に富み乾きにくい (`baseMoisture` 高 / `moistureRelaxPerTick` 低)
- [x] 「時代」概念 (胞子期 → 拡散期 → 変形体期) と DAY カウンタの紐付け
  - `game.ts`: `eraName(day)` が DAY から時代名を導出し HUD に表示。切り替わりの節目は `checkEraTransition()` が「進化の記録」に残す
- [x] 環境バランスの自然減衰 (放置するとエサが消費される / 水が乾く)
  - `sim/env/environment.ts`: `GridEnvironment.decay()` が栄養を0へ、水分を土地本来の `baseMoisture` へ毎tick緩和する。速度はステージごとに異なる

### M4 — ゆるい目標
- [x] メインクエスト: 「拠点をすべてつなぐ」「大陸の70%を探索する」
  - `web/src/quests.ts`: `computeQuests()` が WorldInfo (拠点到達率) と Traits.exploration (探索性、M0 で定義されたまま HUD に出ていなかった3軸スコアをここで初採用) から2クエストの進捗を導出する純粋関数
- [x] デイリーチャレンジ: 「最短でつなぐ」「最小コストでつなぐ」「障害物を避けてつなぐ」
  - `web/src/challenges.ts`: 日付文字列のハッシュで3種のうち1つを決定的に選ぶ (サーバ不要)。`DailyChallengeTracker` が達成状態を日付ごとに localStorage へ記録 (1日1回)
- [x] アチーブメント (広がりし者 / つなぎし者 / 適応せし者 …)
  - `web/src/achievements.ts`: 7種の実績 (広がりし者 / つなぎし者 / 適応せし者 / 太き幹の民 / 博物学者 / 旅する者 / 挑戦せし者) を毎フレーム判定し、一度解除したら消えない形で localStorage に記録
- [x] スコア&タイム自動記録
  - `web/src/scoreboard.ts`: ステージごとに「全拠点接続までの最短日数」「3軸スコアの最高値」「最大質量/面積」のベスト記録を自動更新して localStorage に保存

### M5 — 子孫を残す
- [x] 育てた個体の「種」を採取 → 次プレイの初期パラメータに遺伝
  - `sim/graph/genome.ts`: `createChildGenome(parent, rng, mutationScale)` が親の Genome を継承しつつ変異させた子を決定的に生成 (sim 側の純粋関数として `createGenome` と対の存在)
  - `web/src/lineage.ts`: `Lineage` が採取した種 (世代ごとの Genome / タイプ / 個性) を localStorage に記録。次回起動時・リセット時・ステージ変更時に自動で最新の種を継承する
- [x] 系統樹 UI (1代目 / 2代目 / 3代目 …)
  - 左ペインに「系統樹」カードを追加。「種を採取」ボタン (Day 5 以降で有効) と、これまでの世代を一覧表示
- [x] 環境変化と子孫個性の連動
  - `web/game.ts` の `mutationScaleFor()`: ステージの自然減衰速度 (`nutrientDecayPerTick` / `moistureRelaxPerTick`) が大きい (=過酷な) ステージほど、継承時の変異幅が大きくなる。同じ親の種でも、植える土地によって子の個性の振れ幅が変わる

### M6 — World View
- [x] 複数ソースを大マップに配置 → ズームアウトで俯瞰、ズームインで個体ビュー
  - `web/src/game.ts`: `SOURCE_POINTS` (3箇所) に `seedSource()` を複数回呼ぶだけで実現 (sim 側は元々複数 source を区別なく扱えるため無改修)。既存のズーム範囲 (1〜8倍) がそのまま「zoom=1で全コロニーを俯瞰」「zoom>1で1コロニーに寄った個体ビュー」になる
  - `web/src/camera.ts`: `Camera.focusOn(pos, zoom)` を追加。ミニマップのクリックで特定コロニーへズームインする「個体ビュー切り替え」に使う
- [x] ミニマップ + コロニー数 / 接続ネットワーク数の HUD
  - `web/src/colony-networks.ts`: `computeColonyNetworks()` が Union-Find でエッジを辿り、各コロニーがどの連結成分 (ネットワーク) に属すかを純粋関数として導出 (sim 側に「コロニー」概念を持ち込まない)
  - `web/src/minimap.ts`: 世界全体のコロニー位置 + 現在のカメラ視野矩形を描く軽量ミニマップ。クリックでそのコロニーへ `camera.focusOn()`
  - 左ペイン「ワールドビュー」カードに統合ネットワーク数 / コロニー総数を表示
- [x] 拠点同士の接続が「世界目標」達成度に効く
  - `web/src/quests.ts`: 新設クエスト `unite-colonies` (「離れたコロニーをひとつに」)。進捗 = `(sourceColonies - connectedNetworks) / (sourceColonies - 1)`。コロニーの growth が物理的に隣のコロニーへ到達しネットワークが1つに統合されるほど進む

### M7 — 仕上げ
- [ ] 環境音 + アンビエント BGM (Howler.js or WebAudio 直)
- [ ] スクリーンショット保存 (album)
- [x] PWA (オフライン起動 / ホーム画面追加)
  - `vite-plugin-pwa` (Workbox `generateSW`) を導入し、ビルド成果物一式をプリキャッシュ。`navigateFallback` で SPA のオフライン起動に対応
  - `manifest.webmanifest` (`display: standalone` / アイコン4種 [192・512 の通常 + maskable]) を生成し、ホーム画面に追加してアプリのように起動できる
  - iOS 向けに `apple-touch-icon` / `apple-mobile-web-app-*` メタタグを追加。スタンドアロン起動時のノッチ/ホームインジケータ対策に `env(safe-area-inset-*)` を適用
- [x] モバイル UI (タップ & ピンチズーム)
  - `web/src/pinch.ts`: `PinchTracker` が2本指の距離・中点からズーム倍率とパン量を導出する純粋なステート
  - `web/src/main.ts`: Pointer Events で1本指タップ/ドラッグ (ツール配置、マウスと共通の経路) と2本指ピンチ (ズーム+パン) を判別。2本指ピンチの1本目として誤ってツールが置かれないよう、1本指タップの確定を短く遅延 (`TAP_GRACE_MS`) させ、2本目が来ればタップを破棄する
  - `#canvas` に `touch-action: none` を設定し、ブラウザ標準のスクロール/ピンチズーム/ダブルタップズームと競合しないようにする
- [ ] GitHub Pages へ自動デプロイ (`.github/workflows/pages.yml`)

## アーキテクチャ方針

- **sim はステートレスに保つ** — UI 側は SimState のスナップショットを読むだけ。書き込みは `Environment.placeX()` 経由に限定する。
- **描画はラッパー** — `@morpho/web` は sim を import するだけで、sim 側に描画依存を持ち込まない (Node でも引き続き使える)。
- **時間スケールは UI に切り出す** — sim は「1 tick」しか知らない。日数や時代は web 側の派生量。
- **個性 / 図鑑 / 子孫は web 側で持つ** — sim は遺伝子を1個体ぶん受け取って動くだけ。永続化は localStorage。
- **リポジトリルートは pnpm workspaces** — `@morpho/web` は `@morpho/sim` をビルド成果物ではなく `../sim/src` を直接 import している。
  そのため install は必ずリポジトリルートで行うこと。`packages/web` や `packages/sim` の中だけで install すると、
  もう片方の依存 (`seedrandom` など) が解決できずに壊れる。
- **tick は Worker、描画はメインスレッド** — `Game` (state / env / fields) の実体は `sim-worker.ts` の中で動く。
  メインスレッドは `game-proxy.ts` (`GameProxy`) を通じて postMessage で命令 (setTool 等) を送り、
  最新スナップショットを受け取って描画するだけ。速度倍率を上げても入力やホバー表示が詰まらない。

## 動かし方 (M0)

```sh
pnpm install      # リポジトリルートで一度だけ (workspaces が両パッケージの依存を解決する)
cd packages/web
pnpm dev
# → http://localhost:5173 で遊べる
```
