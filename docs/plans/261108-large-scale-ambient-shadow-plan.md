# 大きな凹凸の立体感を補う環境光の影 (GTAO の近距離 + 粗い multishadow の遠距離)

画面の描画で、大きなポケット・溝・飛び出した部分の立体感を出す。細部の凹みは既存の GTAO (画面空間の AO) で十分に
出ているので、GTAO が苦手な**遠い距離 (大きな形) の遮蔽だけを補う**ものを足し、GTAO の結果と掛け合わせる。
同じ仕組みで、主光源の側から来る柔らかい影 (飛び出した部分が落とす影) も、追加の描画無しで出す。

関連:
- [gtao-screen-space-ao](../architecture/gtao-screen-space-ao.md): 今の GTAO のパイプライン。この計画はその AO の
  パスに相乗りする。
- [console-chimerax-dialect](../architecture/console-chimerax-dialect.md) の `lighting`: 今は `soft` / `gentle` /
  `full` を GTAO で近似して warn している。実装したら対応を書き換える。
- [261108-clip-planes-and-caps-plan.md](261108-clip-planes-and-caps-plan.md): clip を入れたら、切った部分を影の
  地図にも入れない (§7)。

---

## 1. 調べたこと (2026-11-08)

### 近年の作り: 近距離は画面空間、遠距離は世界座標

ゲームエンジンも Blender も、AO を 1 つの方法で全部の距離をまかなわず、**近距離を画面空間 (horizon 系)、遠距離を
世界座標の粗い表現**で受け持つ形になっている。

- **Unreal の Distance Field AO**: 物の符号付き距離場 (SDF) と、粗い全体の距離場を cone tracing して、遠くの遮蔽を
  出す。画面空間の AO の弱点 (画面の外や手前の物に隠れた情報が無い) を補うためのもので、世界座標なので画面の外の
  欠けが無い。cone 数本で半球全体の柔らかい見え方を出す。
  ([SIGGRAPH 2015](https://advances.realtimerendering.com/s2015/DynamicOcclusionWithSignedDistanceFields.pdf)、
  [UE docs](https://dev.epicgames.com/documentation/unreal-engine/distance-field-ambient-occlusion-in-unreal-engine?lang=en-US))
- **Blender EEVEE (4.2 以降の EEVEE Next)**:
  - AO と高速な GI は horizon scan (GTAO と同じ系統) に作り直された
    ([PR #114150](https://projects.blender.org/blender/blender/pulls/114150))。depth を高さの場として扱う欠点に
    対して、「Thickness Near」(幾何的な厚み、距離で弱まる) と「Thickness Far」(角度の厚み) を持つ
    ([manual の PR](https://projects.blender.org/blender/blender-manual/pulls/104816/commits/1ca9b7780c525be8195803d13e523413efac4eaa))。
  - 遠い範囲の間接光は、焼き付けた Light Probe Volume (格子の点ごとに小さな影の地図を持って光の漏れを抑える) が
    受け持つ ([manual](https://docs.blender.org/manual/ja/4.3/render/eevee/light_probes/volume.html))。
  - 影は virtual shadow map で、光源から影の地図の中を辿って柔らかい影を出す
    ([developer docs](https://developer.blender.org/docs/features/eevee/modules/shadow/))。
- **Visibility bitmask (Therrien ら 2023)**: GTAO の 2 つの horizon 角の代わりに、扇形ごとの見え方を bit で持ち、
  一定の厚みを仮定して物の裏へ光を通す。GTAO を大きな半径にしたときの暗くなりすぎ (halo) を減らせる
  ([arXiv 2301.11376](https://arxiv.org/abs/2301.11376v2))。

### 分子の表示ソフト

- **ChimeraX の multishadow** (`lighting soft` / `gentle`): 64 方向から深さの地図を作り、画素ごとに平均して環境光を
  弱める。`gentle` は 1 方向あたり 16 px 程度まで粗くし、大きな形だけを出す。回転では作り直さない (ソースで確認。
  `graphics/src/opengl.py` の `Multishadow`)。
- **QuteMol** (Tarini ら 2006): 多方向の影の地図で AO を前計算する。同じ系統
  ([論文](https://erzherzog.cg.tuwien.ac.at/courses/Visualisierung2/HallOfFame/2013/Gruppe18/Homepage/data%5Cpaper%5CTarini_FinalVersionElec.pdf))。
- **Mol\***: multi-scale SSAO (複数の半径の画面空間 AO を重ねる) と、画面空間の影 (depth を光の向きに辿る。
  `steps`、`maxDistance`、`tolerance`) を持つ。どちらも画面空間
  ([viewport settings](https://molstar.org/me-docs/viewport/)、
  [ShadowPass の型](https://cdn.jsdelivr.net/npm/molstar@5.8.0/lib/mol-canvas3d/passes/shadow.d.ts))。
- **MegaMol / Grottel ら 2012**: 粒子の密度の格子から、近傍の遮蔽を物体空間で求める。
- **Sculptor** (Wahle と Wriggers 2015): 空間の尺度を変えられる画面空間の AO
  ([PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4623981/))。

## 2. 方法の比較

求めるもの: GTAO と役割が重ならない (遠距離だけ)、安い、大きなポケット・溝・飛び出しの立体感が出る、CueMol の
どの renderer (球・棒、ribbon、表面、地図) にも効く、WebGL2 で動く。

| 方法 | 遠距離の遮蔽 | GTAO との組み合わせ | 費用 | 全 renderer | 判断 |
|---|---|---|---|---|---|
| **粗い multishadow を AO のパスで引く** | 世界座標。画面の外や裏の物も入る | 近い遮蔽物を外して遠距離だけにできる (§3.2) | 形が変わったときに N 回の深さの描画。毎フレームは画素 × N 回の参照 | 描いた物そのものの深さなので、全部に効く | **推す** |
| SDF / 密度の格子を cone tracing (Unreal、MegaMol 系) | 世界座標。Å で範囲を決めやすい | 同じく遠距離だけにできる | 格子の作成 + 画素ごとに cone 数本 | 原子からは作りやすいが、ribbon・表面・地図は格子への焼き込み (voxel 化) が別に要る | 次点。multishadow の作り直しが重すぎる場合 (MD の再生など) の代わり |
| multi-scale の画面空間 AO (Mol\*) | 見えている面だけ | 同じ仕組みの重ね掛け | 最も安い | 全部 | 見る向きで変わり、裏の物が入らない。推さない |
| GTAO を visibility bitmask に替える | 近距離の質が上がるだけ | 置き換え | GTAO と同程度 | 全部 | 目的が違う。大きな半径の halo が問題になったら別に検討 |
| 画面空間の影 (Mol\*) | 見えている物の短い影だけ | 別の項 | 安い | 全部 | 飛び出しの大きな影は出ない。推さない |
| 主光源の shadow map | 影は出る。凹みは暗くならない | 別の項 | 光がカメラに付いているので、回転のたびに深さの描画 | 全部 | 目的とずれる。後の候補 |

**multishadow を推す理由**: Blender や Unreal と同じ「近距離は画面空間、遠距離は世界座標」の分け方を、CueMol の
条件 (renderer の種類が多い、WebGL2) で一番安く作れる。描いた物そのものから深さの地図を作るので、renderer ごとに
代わりの表現を作らなくてよい。分子の表示ソフトで実績がある (ChimeraX、QuteMol)。

## 3. 方針

### 3.1 影の地図を作る (C++)

- 地図は depth texture 1 枚で、区画に分けて N 方向を並べる。
  - 既定は N = 32、1 方向あたり 48 px (1 枚は 6×6 区画で 288 px 四方程度)。N と大きさは Scene のプロパティ。
  - 方向は球面上に均等に並べ (Fibonacci 格子など)、シーン座標に固定する。
- 方向ごとに、シーンの外接球を囲む正射影で、不透明な物の depth だけを描く。
  - 色は書かない。pick のパス (`GUIView::renderPickBuffer`) と同じく、描画先・viewport・投影・view 行列を
    差し替えて `Scene` の表示を回す。
  - 透明な物と、線・ラベル・地図の mesh は描かない (遮蔽物にしない)。
  - impostor (球・円柱) は正射影の depth をそのまま使う (CueMol は正射影の表示を持つ)。
- 方向ごとの「シーン座標 → 地図の区画の座標」の行列 (N 個) を UBO に入れる。
- **作り直す時**: シーンの形が変わったとき (renderer の作り直し、表示の on/off、object の xform、object の追加と
  削除)。カメラだけの変化 (回転・移動・zoom・slab) では作り直さない。
  - 「形が変わった」をどこで拾うかは、着手時に Scene のイベント (renderer の invalidate、表示や xform の変更) を
    調べて決める。拾い漏れる所は、作り直しの命令を明示的に出す。
  - MD の trajectory の再生中は毎フレームが形の変化になる。再生中は作り直しを止め、止まったら作る (既定)。

### 3.2 AO のパスで引く (シェーダー)

`gtao_frag.glsl` に項を足す。depth から戻した eye 座標の点を、inverse view 行列でシーン座標に直してから:

- **遠距離だけにする (GTAO と重ねるための要点)**: 地図を引く点を、法線の向きに `max(GTAO の半径, 地図の 1 px)`
  だけずらす。これで GTAO の半径より近い遮蔽物は外れ、近距離は GTAO、遠距離は multishadow と役割が分かれ、
  同じ凹みを二重に暗くしない。Unreal の「近くは物の距離場、遠くは全体の距離場」、Blender の「Thickness Near が
  距離で弱まる」と同じ考え方。
- **環境光の遮蔽** `AO_far`: N 方向を `sampler2DShadow` で引き、`max(0, dot(n, dir))` で重み付けして平均する
  (ChimeraX と同じ)。
- **柔らかい方向のある影** `S_key`: 同じ N 個の結果を、主光源の向き `L` (今はカメラに固定、`lighting_inc.glsl` の
  `(1, 1, 1.5)`) に近い方向ほど重く (`pow(max(0, dot(dir, L)), k)`) 平均し直す。
  - 光はカメラに付いているので回転のたびに向きが変わるが、全方向の地図は既にあるので、重みを変えるだけで
    **作り直しは要らない**。
  - 影の柔らかさは `k` で決まる (方向の間隔が約 30° なので、柔らかい影になる)。飛び出した部分が下・奥に落とす影が
    出る。
- 外す物 (`isExcluded`) と背景は 1 (遮蔽なし)。
- AO の RT (RGBA8) の空いている B に `AO_far`、A に `S_key` を書く。今の R は GTAO、G は edges
  (`gtao_frag.glsl:327`)。denoise は B と A も同じ重みで均す。
- **合成** (`ao_composite_frag.glsl`): `color × AO_gtao × mix(1, AO_far, s_far) × mix(1, S_key, s_key)`。fog の
  奥で弱めるのは今の AO と同じ。
  - 今の色のバッファは、頂点ごとに計算した lighting の結果 (環境光と直接光の和) なので、`S_key` を直接光だけに
    掛けることはできず、`s_key` で控えめに掛ける近似になる。直接光を別の MRT に出して正しく掛けるのは、
    ライティングの uniform 化と合わせて後で検討する。
- GTAO が off で、こちらだけが on のときも、同じパスで GTAO の部分を飛ばして動く。`requiresFramePipeline()`
  (`src/qsys/Scene.hpp:283`) にこの条件を足し、MRT の法線もそのとき確保する。

### 3.3 プロパティと UI

- Scene のプロパティ (`.qsc` に保存。既定値は書かない):
  - `farAoEnabled` (boolean、既定 false)、`farAoStrength` (real)。
  - `keyShadowStrength` (real、0 で off)、`keyShadowSoftness` (`k` を UI 向けに言い換えたもの)。
  - `farAoDirections` (integer、既定 32)、`farAoMapSize` (integer、1 方向あたりの px、既定 48)。
- GUI: scene の inspector の AO の項 (`features/inspector/schema/scene.ts` の `scene-ao`) に、「Large-scale
  occlusion」と「Soft key shadow」を足す。品質の preset (`data/sceneQualityPresets.ts`) に入れるかは決める。

### 3.4 ChX console

- `lighting soft` / `gentle`: GTAO に加えて `farAoEnabled` を入れる。`gentle` は地図を粗くする。
- `lighting full`: さらに `keyShadowStrength` を入れる。主光源の鋭い影ではなく柔らかい影になる違いは warn する。
- `lighting multiShadow n`: n を方向の数に使う (設定の範囲に丸めて warn)。`msMapSize` も対応する。`shadows true`
  は `keyShadowStrength` に当てる。
- `lighting simple` / `default`: どちらも切る。

### 3.5 保存する画像

- PNG の保存 (`OffScreenView`) が GTAO と同じパイプラインを通るなら、そのまま効く。着手時に確かめる。
- umbreon や POV-Ray には関係しない (あちらは本物の AO・影・GI を持つ)。

## 4. 費用の目安と測ること

- 地図を作る: N 回の深さの描画。費用はシーンの頂点や impostor の数 × N。4v6x の球の表示 (23 万原子) で N = 32
  なら数十〜数百 ms の見込み。形が変わったときだけ。
- 毎フレーム: 画素ごとに N 回の参照 (比較付きの hardware filtering)。半解像度の 1920×1080 なら約 50 万画素 × 32。
- 実装の最初に、4v6x と小さいタンパク質で、地図を作る時間と 1 フレームの時間を GTAO だけのときと比べて測り、
  このプランに書き足す。地図の作成が重すぎれば、§2 の SDF / 密度の格子に切り替えるかを判断する。

## 5. 段階

1. 地図を作る処理と `AO_far` (§3.1、§3.2 の環境光の遮蔽、法線の向きのずらし)。目視で GTAO との重なり方を決める。
2. `S_key` (柔らかい方向のある影)。
3. GUI と ChX。

## 6. 受け入れること

- 地図が粗いので、細い物 (側鎖 1 本など) はほとんど影を落とさない。それは GTAO の範囲として受け入れる。
- 正射影の深さの地図なので、遮蔽物の厚みは「その方向から見て一番手前の面の奥すべて」になる。遠距離では問題に
  なりにくい。
- 形が変わると、地図を作り直すまで 1 フレーム遅れうる。

## 7. clip との関係

- clip (front / back) を入れたら、切った部分は地図にも描かない (切り取った物は無いものとして扱う)。切って見せた
  ポケットの中が暗くならないようにするため。clip の面を動かしたら地図を作り直す。
- near / far (カメラに付いた面) では作り直さない (回転のたびになるため)。

## 8. テスト (最小)

- C++ (gtest): `requiresFramePipeline()` が `farAoEnabled` だけでも true になること (これだけを入れたときに
  パイプラインを通らないと、何も描かれないため)。
- tritium: ChX の `lighting soft` / `full` / `simple` が書くプロパティ (既存の `lookCommands.test.ts` の preset の
  期待値に足す)。
- 見た目と速さはユーザーの目視と §4 の測定で確かめる。

## 9. 決めること

1. 方向の数と地図の粗さの既定 (N = 32、48 px で始め、目視で決める)。
2. GUI で粗さを px で出すか、Å で出すか (分子の大きさで 1 px の Å が変わる)。
3. 品質の preset に入れるか。入れる場合、標準で on にするか。
4. `S_key` を最初から入れるか、`AO_far` の目視の後にするか (この計画は段階を分ける)。
5. 主光源の向きを、ライティングの uniform 化 (別の計画) の前に、`lighting_inc.glsl` の定数と同じ値の uniform として
   先に出すか。
