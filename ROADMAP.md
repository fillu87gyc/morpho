# モルフォ — Web ゲーム化ロードマップ

> 「制御する」のではなく、「条件を整え、振る舞いを引き出す」。
> モックアップで描いた粘菌育成体験へ、既存の `@morpho/sim` を段階的に拡張する計画。

## 現在地

- **`@morpho/sim`** — 粘菌のローカル則 (グラフ成長 / Biomass膜 / Activity場 / 環境ツール) は完成済み。Node から PNG を吐く `scripts/render.ts` で挙動確認可能。
- **`@morpho/web`** — `@morpho/sim` を `<canvas>` に貼り、HUD・ツールパレット・図鑑・系統樹・アルバム・環境音などモックアップの体験一式が揃った状態。M0〜M8 の全マイルストーンが完了。
- **速度** — 速度スライダーの上限 ×24 に対し、通常モードで実効 ×4〜7、早送りモード (⏩) で ×10 前後まで出る。描画は 0.8〜1.5ms/frame で目標 (3ms) を大きく下回り、残るボトルネックは sim 側の tick コスト (エッジ数に比例) のみ。詳細は M8 参照。

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
- [x] WebGL2 or `OffscreenCanvas` バックエンド (希望者向け) → M8-P3 に統合。P1〜P3 の Canvas2D 最適化後の実測で目標を大きく下回ったためスコープアウト (詳細は M8-P3 参照)
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
- [x] 環境音 + アンビエント BGM (Howler.js or WebAudio 直)
  - `web/src/ambient.ts`: `Ambient` クラスが WebAudio だけで手続き的に環境音を生成 (外部音声ファイルなし、PWAのキャッシュ対象が増えない)。ドローン (低い正弦波3本) + フィルタ済みノイズ (風/水のテクスチャ) + LFOによるカットオフの「呼吸」+ ステージごとのランダムなきらめき音 (洞窟の水滴・湿地の虫の音 等) をステージごとに切替。自動再生ポリシーに対応し、トグルボタン (`#toggle-ambient`) のクリック (ユーザー操作) からのみ `AudioContext` を生成・resumeする
- [x] スクリーンショット保存 (album)
  - `web/src/album.ts`: `Album` クラスが撮影した PNG を IndexedDB (localStorage は容量が小さく画像保存に不向き) に保存。左記UIカード「アルバム」に撮影ボタンとサムネイル一覧 (クリックでダウンロード、削除ボタン) を追加。`canvas.toBlob()` (非同期) で画面に見えている通りの絵をそのまま撮る
- [x] PWA (オフライン起動 / ホーム画面追加)
  - `vite-plugin-pwa` (Workbox `generateSW`) を導入し、ビルド成果物一式をプリキャッシュ。`navigateFallback` で SPA のオフライン起動に対応
  - `manifest.webmanifest` (`display: standalone` / アイコン4種 [192・512 の通常 + maskable]) を生成し、ホーム画面に追加してアプリのように起動できる
  - iOS 向けに `apple-touch-icon` / `apple-mobile-web-app-*` メタタグを追加。スタンドアロン起動時のノッチ/ホームインジケータ対策に `env(safe-area-inset-*)` を適用
- [x] モバイル UI (タップ & ピンチズーム)
  - `web/src/pinch.ts`: `PinchTracker` が2本指の距離・中点からズーム倍率とパン量を導出する純粋なステート
  - `web/src/main.ts`: Pointer Events で1本指タップ/ドラッグ (ツール配置、マウスと共通の経路) と2本指ピンチ (ズーム+パン) を判別。2本指ピンチの1本目として誤ってツールが置かれないよう、1本指タップの確定を短く遅延 (`TAP_GRACE_MS`) させ、2本目が来ればタップを破棄する
  - `#canvas` に `touch-action: none` を設定し、ブラウザ標準のスクロール/ピンチズーム/ダブルタップズームと競合しないようにする
- [x] GitHub Pages へ自動デプロイ (`.github/workflows/pages.yml`)
  - main への push で `packages/web` をビルドし GitHub Pages へ公開。GitHub Pages はリポジトリ名のサブパス (`https://<owner>.github.io/<repo>/`) に配置されるため、`vite.config.ts` の `base` を `VITE_BASE` 環境変数から決定 (未設定時はローカル開発と同じ `/`)。PWA manifest の `start_url`/`scope`/`id` も同じ `BASE` から導出し、サブパス配下でも Service Worker のナビゲーションフォールバックが機能するようにした

### M8 — 速くする (パフォーマンス)

> ゲームを「早く」するためのマイルストーン。計測に基づく現状と、足りないものの棚卸し。

#### 現状の計測 (2026-07 / Node 22 / petri 3コロニー / 60日走行, 約350ノード・360エッジ)

| 項目 | 実測 | 影響 |
| --- | --- | --- |
| 1 tick | 1.5〜2.1 ms (エッジ数にほぼ比例して増加) | 速度×24 は 16ms 予算に対し 36〜50ms 必要 → **実効 ×8 前後で頭打ち**。スライダーの ×24 は看板倒れ (モバイルではさらに低い) |
| tick 内訳 | biomass 41% / activity 40% / flux 10% / index 6% | 上位2つ = エッジ毎の場書き込み + 毎tick全面拡散 + `crowdingAt` が全体の約8割 |
| snapshot の structuredClone | 0.9〜1.1 ms | Worker→メインへ **60Hz で毎回** クローン送信 (env/bio の Float32Array 5面 ≈ 180KB + 全ノード/エッジのオブジェクト群)。GC 圧の主因 |
| snapshot の派生計算 | 0.05〜0.6 ms | `computeTraits` / `computeIndividuality` / `computeColonyNetworks` (Union-Find) / 全面グリッド走査×2 (balance/world) を tick が進んでいなくても 60Hz で再計算 |

ボトルネックの所在 (コード上の根拠):

- `sim/graph/life.ts` `updateActivity()` — エッジ毎に `crowdingAt()` を呼ぶ。`crowdingAt` は全ノード線形走査なので **O(エッジ数×ノード数) が毎tick** (350×360 ≈ 13万距離計算/tick)。さらにエッジ毎の `env.sampleGrowthContext()` + `actField.deposit()` + 毎tickの全面 `diffuse()`
- `sim/graph/life.ts` `updateBiomass()` — エッジ毎に `depositSegment()` (線分に沿ってディスクを重ね塗り) + 毎tickの全面 `diffuse()`
- `sim/graph/flux.ts` `updateFlux()` — **sink 毎に毎tick BFS**。sink は成長で増え続けるため後半ほど重い
- `sim/graph/step.ts` — `buildIndex()` が毎tick Map/Set をゼロから再構築 (増分更新なし)
- `web/src/sim-worker.ts` — `setTimeout(16)` 固定で「speed 回ぶん全部回してから snapshot」。時間予算の概念がなく、間に合わないと黙って遅れる。実効速度の観測手段もない
- `web/src/render.ts` `drawEdges()` — 毎フレーム `new Map(nodes)` + `[...edges].sort()` + エッジ毎に `strokeStyle` 設定と `stroke()` 呼び出し (スタイルバッチなし)。`drawNodes()` も毎フレーム radial gradient を生成
- `web/src/main.ts` `frame()` — `ui.render()` / achievements / scoreboard / challenge 判定を差分有無に関わらず毎 RAF 実行

> P0 と P1 (`crowdingAt` のグリッド化 / `updateFlux` のマルチソース BFS化 / `buildIndex` のキャッシュ化 /
> diffuse の間引き / `depositSegment` の line-stamp化) を実施済み。同条件のベンチで 1 tick 平均
> 0.5〜0.7ms 程度 (petri 3コロニー、tick 1500 まで) まで縮んだ。以後の実測は
> `pnpm --filter @morpho/sim run bench` (`sim/scripts/bench.ts`) で追える。上表は変更前のベースラインとして残す。

#### 足りないもの (このマイルストーンで揃える)

- [x] **P0: 計測基盤** — 何もない状態なので最初に揃える
  - [x] perf HUD (ms/tick, 描画ms, FPS, 実効速度倍率をオーバーレイ表示。`?debug` で有効化)
    - `web/src/perf-hud.ts`: `PerfHud` が画面左上に計測値を表示。tick 計測は `sim-worker.ts` (`game.tick()` を計測し `PerfInfo` として snapshot と一緒に送る)、描画計測は `main.ts` の `frame()` が担う
  - [x] `sim/scripts/bench.ts` (tick コストの成長カーブ + サブステップ内訳を出力する再現可能ベンチ)
    - `pnpm run bench` でフルレポート、`pnpm run bench -- --smoke` で CI 向けの短時間実行
  - [x] CI にベンチのスモーク実行を追加 (極端な回帰の検出。閾値は緩めに)
    - `.github/workflows/ci.yml` の `sim` ジョブに `Bench smoke` ステップを追加 (閾値 30ms/tick というかなり緩い基準で O(n^2) 化などの壊滅的回帰だけを検出)
- [x] **P1: sim の熱いループ** — 目標: 1 tick を 0.5ms 以下 (×24 が 16ms 予算に収まる = 24×0.5+描画で間に合う)
  - [x] `crowdingAt` の O(E×N) を撤廃: ノード密度を粗いグリッド場に毎tick一度だけ焼き、エッジはそれを sample する (O(N+E) 化)
    - `sim/graph/index-utils.ts`: `buildDensityGrid()` が cellSize == radius の一様グリッドへノードをバケツ分けし、`crowdingAt()` は 3x3 近傍だけを見る (元の「半径内に厳密に入っているか」の判定は変えず、候補を絞るだけなので結果は不変)
  - [x] `updateFlux` の sink毎BFS を、全 sink を起点にした 1 回のマルチソース BFS に統合
    - `sim/graph/flux.ts`: 全 source を起点にした 1 回の BFS で「各ノードから見て最も近い source」を求め、各 sink はその経路を辿るだけにした (O(sink数×(V+E)) → O(V+E))
    - 頻度の間引き (2〜4 tick毎) は見送り: 挙動が変わるため今回はスコープ外
  - [x] `buildIndex` の増分更新 (growth/prune 時だけ差分適用。まず prune 直後だけ再構築でも大きい)
    - `sim/graph/step.ts`: `StepCache` (`createStepCache()`) が `buildIndex` の結果を tick を跨いで使い回す。growth (12 tick毎) は元々 idx を差分更新済みなのでそのまま活かし、prune (60 tick毎) の直後だけ無効化して次 tick で再構築する。`Game` (web) は `reset()` で作った `StepCache` を tick ループ全体で使い回す
  - [x] activity / biomass の全面 `diffuse()` を 2 tick 毎に間引く (係数を等価調整して見た目を保つ)
    - `sim/graph/life.ts`: `updateActivity`/`updateBiomass` は deposit (書き込み) を毎tick行ったまま、`diffuse()` (拡散+減衰) だけ `state.tick % 2 === 0` の時に限定し、係数 (decay/diffusion) を2倍にして「2tickぶん」を1回で近似する。伝播が最大1tick遅れるだけで見た目は保たれる
  - [x] `depositSegment` のディスク重ね塗りを line-stamp 一発 (距離場ベース) に置き換え
    - `sim/env/biomass-field.ts`: 線分を何個ものディスクで重ね塗りする代わりに、線分のバウンディングボックスを1回走査し、セル毎に線分までの最短距離 (射影点との距離) から重みを直接計算する。重なり範囲を何度も塗り直す無駄がなくなり、結果は同じ capsule 形状
- [x] **P2: Worker ⇄ メインのパイプライン** — 目標: snapshot 送信を 60Hz クローンから「描画に必要な最小データの transfer」へ
  - [x] 時間予算スケジューラ: 16ms 予算内で回せるだけ tick を回し、間に合わない分は繰り越す。実効速度を HUD に出す (「×24 と言いつつ ×8」の可視化と解消)
    - `web/src/tick-scheduler.ts`: `TickScheduler` が純粋なステートマシンとして「借金 (debt)」を管理。tick コストの実測 EMA から今回回せる tick 数を見積もり、間に合わなかった分は次フレームへ繰り越す。借金には上限 (`maxDebtTicks`) を設け、タブ復帰直後などの一気読みを防ぐ
    - `web/src/sim-worker.ts`: 従来の `for (i < speed)` 固定ループを `scheduler.planSteps(game.speed)` の結果に置き換え。`Game.tick(steps)` に明示的な tick 数を渡せるようにした (`web/src/game.ts`)
  - [x] 描画用スナップショットを typed array 化 (nodes/edges を Float32Array にパック) して postMessage の transferable で渡す (クローンゼロ化)。env/bio の Float32Array も transfer + Worker 側でダブルバッファ
    - `web/src/snapshot-codec.ts`: `packNodes`/`packEdges` が `SimState.nodes`/`edges` (数百個のオブジェクト配列 — structuredClone が個別に辿る必要があり計測上の主要コスト) を Float32Array に平坦化。`unpackNodes`/`unpackEdges` で受信側が元のオブジェクト配列に復元するので、render.ts/quests.ts など既存のコンシューマは無改修
    - `web/src/worker-protocol.ts`: `WireSnapshot` (`GameSnapshot` から `state` を除き `stateMeta`/`nodesBuf`/`edgesBuf` を持つ送信専用の形) を追加。`sim-worker.ts` は `postMessage(msg, [nodesBuf.buffer, edgesBuf.buffer])` で transferable 転送し、`game-proxy.ts` が受信時に `SimState` へ復元する
    - env/bio の Float32Array (5 面, 9216セル) は structuredClone の高速パス (typed array は要素ごとではなく一括コピー) で既に低コストであり、計測上のボトルネックは nodes/edges 側だったため、ダブルバッファ化 (sim の `ScalarField` 内部の拡散用バッファと兼用する設計変更が必要でリスクが高い) は見送り、効果の大きい nodes/edges 側のみ実施した
  - [x] 派生計算 (traits / individuality / colonyNetworks / balance / world / quests) を「tick が進んだときだけ + 250ms 毎」に間引く
    - `web/src/game.ts`: `snapshot()` を `snapshotFast()` (state/env/bio など毎tick必要な部分) と `snapshotDerived()` (traits 以下の派生計算) に分割
    - `web/src/sim-worker.ts`: `snapshotDerived()` は reset/apply 直後のみ即時再計算し、それ以外は 250ms 毎に間引いて使い回す。`snapshotFast()` は引き続き毎 tick 作り直す
    - 「描画データと別チャンネルで低頻度送信」(postMessage の payload 自体を分離してクローン量を削る) は見送り: 効果は typed array 化 (未着手の項目) の方が大きく、protocol/GameProxy への影響も大きいためスコープ外
- [x] **P3: 描画** — 目標: 描画 3ms/frame 以下 (モバイル込み)
  - [x] `drawEdges`: nodeMap を snapshot 間で再利用し、sort を radius バケツ分け (数段階) に置き換え、同スタイルのエッジを 1 path にバッチ
    - `web/src/render.ts`: `syncEdgeCache()` が `state` (nodes/edges の参照) が変わらない限り nodeMap と radius バケツ (8分割) を使い回す。RAF が Worker のスナップショット送信より高頻度になりうる (高リフレッシュレート機・一時停止中) ケースでの重複計算を避ける。`drawEdges` は毎フレーム、バケツ内で色/太さを量子化したキーごとに `Path2D` へエッジをまとめ、`stroke()` の呼び出し回数をエッジ数からスタイル種類数まで減らす
  - [x] `drawNodes`: グロー gradient をオフスクリーン sprite に一度だけ焼いて `drawImage` する
    - `web/src/render.ts`: `buildGlowSprite()` が source/sink 用のグローを1枚ずつ (`CanvasRenderer` 構築時に1回) 焼き、`drawNodes` は毎フレーム `createRadialGradient` を呼ばず `drawImage` で必要な直径に拡大するだけにした
  - [x] WebGL2 or `OffscreenCanvas` バックエンド (M1 の未了項目をここへ吸収。P1/P2/P3 の Canvas2D 改善で足りればスコープアウト可)
    - 上記の P3 描画最適化後、実測 (`?debug` の perf HUD、petri ステージでコロニーが育ってエッジ数 400〜580 まで増える範囲) で描画は 0.8〜1.5ms/frame と目標の 3ms を大きく下回って安定しており、Canvas2D のままで十分と判断してスコープアウトした。モバイル実機での追加計測は行っていないが、M1 の差分再描画・M7 のタッチ最適化は別途対応済みであり、将来モバイル実機で描画が重いと分かった場合に再検討する
  - [x] `renderThumbnail` の同期 `toDataURL` を `convertToBlob` (非同期) 化
    - `web/src/render.ts`: `renderThumbnail()` はピクセル描画は同期のまま (直前の `draw()` との整合を保つ必要があるため) だが、PNG エンコードは同期の `toDataURL()` ではなく非同期の `canvas.toBlob()` に置き換え `Promise<string>` (blob URL) を返す。`web/src/timeline.ts` の `maybeCapture()` も呼び出し側を待たせない fire-and-forget 型に更新し、エンコード完了より先に `reset()` された場合は古い世代の結果を破棄して blob URL を解放する
- [x] **P4: 「早送り」体験** (モックアップの早送りボタン)
  - [x] 早送りモード: 描画を 10fps に間引いて浮いた予算を tick に全振り (P2 のスケジューラ上に載せる)
    - `web/src/sim-worker.ts`: 早送り中は Worker 自身のループ間隔を 16ms → 100ms (10fps) に伸ばし、`TickScheduler` の予算 (`setBudgetMs`) と借金上限 (`setMaxDebtTicks`) も同じ比率で引き上げる。ループ間隔が伸びた分、1回あたりに積む要求 tick 数 (debt) も比例して増やさないと「呼ばれる回数が減っただけ」で総 tick 数が減ってしまうため、`game.speed * (100/16)` を要求量として渡す
    - `web/src/tick-scheduler.ts`: `setBudgetMs()`/`setMaxDebtTicks()` を追加し、実行中にスケジューラの設定を切り替えられるようにした
    - `web/src/main.ts`: `frame()` (RAF ループ) も早送り中は同じ 100ms 間隔まで間引く。ヘッダの ⏩ ボタン (`#fast-forward`) でON/OFF
    - 実測 (`?debug` の perf HUD、petri ステージ・速度×24): 通常モードで実効速度 ×6.3〜7.0 だったのが、早送りON後は ×9.9〜10.4 まで向上 (tick コストがボトルネックのため上限は tick 実測に依存するが、約1.5倍の実効速度向上を確認)
  - [x] UI 更新 (`ui.render()` / 実績・記録判定) を早送り中はさらに低頻度化
    - `web/src/main.ts`: `ui.render()` / `achievements.check()` / `scoreboard.record()` / `challenges` 判定 / `encyclopedia.record()` / タイムライン撮影は元々同じ `frame()` 内にまとまっていたため、上記の描画間引きと同じゲートで自然に早送り中は 10fps まで低頻度化される

実施順は P0 → P1 → P2 → P3 → P4、すべて完了。実測ではエッジ数が増えるほど
tick コスト自体が伸びる (400〜580 エッジで 0.8〜2ms/tick) ため「スライダー通りの
×24」は常には出ないが、通常モードで実効 ×4〜7、早送りモードで ×10 前後まで
向上した。描画は 0.8〜1.5ms/frame と目標の 3ms を大きく下回っており、
残るボトルネックは sim の tick コストそのもの (エッジ数に比例) である。

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
