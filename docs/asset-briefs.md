# アセット発注ブリーフ — テクスチャ/スプライトを外部で作ってもらうための依頼書

> M20 (ROADMAP.md) の成果物。この開発環境では画像を生成できないため、
> **人間が画像生成AI (Midjourney / DALL·E / Stable Diffusion / nano-banana 等)
> に貼り付けてそのまま使えるプロンプト**と、生成できない場合の CC0 素材の
> 入手先をここにまとめる。生成した画像は `packages/web/public/textures/` に
> 下記のファイル名で置けば、M21 以降の実装がそのまま読み込む想定。

## 全アセット共通の仕様

- **真上からの見下ろし (top-down)、影は真上光源のアンビエントオクルージョンのみ**。斜め視点・遠近感・強い落ち影は禁止 (フィールドに敷き詰めたとき破綻する)。
- **タイルはシームレス (継ぎ目なし) 必須**。プロンプトに "seamless tileable texture" を必ず含め、生成後に端の連続性を目視確認する。
- 解像度: タイル 1024×1024 / スプライト 512×512 (透過PNG)。
- トーンはモックアップ準拠: 苔の緑 `#4a5d3a`〜`#6b7d4a`、岩の暖グレー `#8a8578`、深い水 `#1e4678`、粘菌の金 `#e8b84b`。彩度は低め、木漏れ日の暖色 (フォトリアル寄り、ただしゲーム画面で主役の粘菌ネットワークより目立たない控えめさ)。

## タイルテクスチャ (地形の下地)

| ファイル名 | 用途 | 英語プロンプト (そのまま貼り付け可) |
| --- | --- | --- |
| `moss-ground.png` | 皿/湿地の地面 | Seamless tileable texture, top-down view, lush forest moss carpet on dark soil, tiny leaves and organic debris scattered, muted mossy green #4a5d3a to #6b7d4a, soft diffuse daylight, photorealistic, no shadows from side, 4k detail |
| `rock-face.png` | 岩場・障害物の面 | Seamless tileable texture, top-down view, weathered grey granite rock surface with cracks and patches of thin moss in crevices, warm grey #8a8578, subtle ambient occlusion in cracks, photorealistic, no directional shadows |
| `sand-dry.png` | 砂漠の地面 | Seamless tileable texture, top-down view, dry cracked desert soil with fine sand ripples and scattered pebbles, warm ochre tones, photorealistic, soft even lighting |
| `stone-ruins.png` | 都市跡の石畳 | Seamless tileable texture, top-down view, ancient weathered stone pavement with broken slabs, moss growing between joints, warm beige stone, photorealistic |
| `cave-floor.png` | 洞窟の床 | Seamless tileable texture, top-down view, damp dark cave floor, wet basalt rock with mineral flecks, cool blue-grey tones, subtle moisture sheen, photorealistic |
| `water-surface.png` | 水域の面 | Seamless tileable texture, top-down view, calm deep lake water surface, subtle ripples and light caustics, deep teal blue #1e4678 fading patterns, photorealistic, no reflections of objects |

## スプライト (透過PNG、地形に散らす小物)

| ファイル名 | 用途 | 英語プロンプト |
| --- | --- | --- |
| `rock-cluster-{1..4}.png` | 岩場の露頭 (モックアップ①中央の主役)。4バリエーション | Single cluster of mossy grey boulders viewed from directly above, photorealistic, moss patches on top, isolated on transparent background, soft ambient occlusion at base, game asset, top-down, 512px |
| `mushroom-red-{1..2}.png` | 赤いキノコ群生 (モックアップの彩り) | Small cluster of red-capped mushrooms with white stems viewed from directly above, photorealistic, isolated on transparent background, top-down game asset |
| `food-orb-orange.png` `food-orb-green.png` | エサ (光る果実/オーブ) | Small glossy glowing orb like a translucent berry, warm orange (variant: fresh green), soft internal glow, viewed from above, isolated on transparent background, game asset |
| `moss-clump-{1..3}.png` | 苔の茂み・下草 | Small tuft of vivid green moss and tiny ferns from directly above, photorealistic, isolated on transparent background, top-down game asset |
| `driftwood.png` | 朽木・小枝 | Small weathered fallen branch with moss, viewed from directly above, photorealistic, isolated on transparent background |

## 生成AIを使わない場合の CC0 入手先

- **ambientCG** (https://ambientcg.com) — Moss / Rock / Ground / Gravel カテゴリ。CC0、1K で十分。
- **Poly Haven** (https://polyhaven.com/textures) — aerial_rocks, mossy_rock 系。CC0。
- **Kenney** (https://kenney.nl/assets) — スプライト系の当て馬に。
- 取り込んだら出典を `packages/web/public/textures/CREDITS.md` に記録する (CC0 でも由来を残す)。

## 受け入れチェック (人間が生成画像を見るときの基準)

1. 2×2 に並べて継ぎ目が見えないか (タイルのみ)。
2. 真上視点か — 側面が見えている岩・斜めの影があるものは NG。
3. 彩度がモックアップより高すぎないか (主役は金色の粘菌。地形は脇役)。
4. スプライトの透過縁にフリンジ (白/黒の縁取り) が出ていないか。
