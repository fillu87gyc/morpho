# テクスチャ/スプライト素材 出典

`docs/asset-briefs.md` の発注ブリーフに沿って人間が画像生成AIで作成した
プレビュー用コンタクトシート (1枚絵) を、Claude が個別ファイルに切り出して
配置した (2026-07-05)。当初 1535×1024px 版で切り出した後、人間が同じ構図の
3070×2048px (2倍解像度) 版を追加提供したため、そちらで全ファイルを再切り出し
済み。

## 既知の制約: 解像度不足

元画像がコンタクトシート1枚 (3070×2048px) にタイル6種+スプライト約50種の
サムネイルを敷き詰めたものだったため、2倍版でも切り出し後の実寸は仕様
(`docs/asset-briefs.md`) を下回る。

| 種別 | 仕様 | 実際の切り出しサイズ (2倍版) |
| --- | --- | --- |
| タイルテクスチャ | 1024×1024 | 約 490×494px |
| スプライト | 512×512 | 約 135〜285px 四方 |

1倍版 (245×247px タイル / 90〜145px スプライト) からは改善したが、まだ
仕様の半分以下。このディレクトリのファイルは **プレースホルダ / 構図確認用**
であり、このままゲームの本番アセットとして使う画質ではない (拡大表示すると
ぼやける)。本番投入前に、`docs/asset-briefs.md` のプロンプトを使って **1枚
ずつ個別に指定解像度で再生成**するか、CC0 素材 (ambientCG / Poly Haven) に
差し替える必要がある。

## ファイル一覧と発注ブリーフとの対応

`docs/asset-briefs.md` が指定する必須ファイルは全て揃っている:

- タイル6種: `moss-ground.png` `rock-face.png` `sand-dry.png` `stone-ruins.png`
  `cave-floor.png` `water-surface.png`
- スプライト5系統: `rock-cluster-{1..4}.png` `mushroom-red-{1..2}.png`
  `food-orb-orange.png` `food-orb-green.png` `moss-clump-{1..3}.png`
  `driftwood.png`

上記に加え、元画像にはブリーフ未記載のボーナス素材も含まれていたため
同様に切り出して収録した (`small-stone-{1..6}` `leaf-litter-{1..4}`
`driftwood-{1,2}` `fern-grass-{1..6}` `water-edge-rock-{1..4}`
`mushroom-{brown,white,yellow,purple}` `decal-{mud,moss,wet}-{1,2}`
`food-orb-{yellow,blue,purple,pink,cyan,white}`)。用途は各々の名前が示す通り
地面デカールやキノコ・食料オーブのバリエーション追加用。
