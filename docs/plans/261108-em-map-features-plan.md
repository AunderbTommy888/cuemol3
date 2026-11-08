# 電顕 map の機能: 囲む体積で level を決める、原子モデルから密度を作る

電顕 (cryo-EM) の map 対応として、今後入れる機能の計画。どれも ChimeraX の tutorial を ChX console で比べたときに、
CueMol 側の機能が無くて同じ絵にならなかったもの ([261107-chx-tutorial-survey-plan.md](261107-chx-tutorial-survey-plan.md) §6)。

1. **囲む体積 (分子量) で level を決める**: ChimeraX の `volume encloseVolume` / `fastEncloseVolume`。
2. **原子モデルから密度 map を作る**: ChimeraX の `molmap`。

**未着手 / 今後実装する**。

関連:
- [cryo-em-map-mode](../architecture/cryo-em-map-mode.md): EM map の level は「格子点の上位 N%」で持つ。
- [261107-chx-tutorial-survey-plan.md](261107-chx-tutorial-survey-plan.md) §6: ChX の `volume encloseVolume` は今は
  断っている (飛ばして続ける)。
- [console-chimerax-dialect](../architecture/console-chimerax-dialect.md)

---

# 1. 囲む体積 (分子量) で level を決める

電顕の map の濃度の値は、装置や処理によって尺度がまちまちで、level の数値そのものには物理的な意味が無い。
そこで「等値面が囲む体積が、分子の体積 (分子量から見積もったもの) になる level」を選べるようにする。

## ChimeraX の機能

`map/src/volume.py` の `surface_level_for_enclosed_volume`:
- **`encloseVolume V`** (Å³): 等値面 (marching cubes の三角形の面) が囲む体積を計算し、V になるまで level を二分探索
  する (許容誤差 1e-3、最大 30 回)。
- **`fastEncloseVolume V`**: 「level より濃い格子点の数 × 1 格子点の体積 = V」となる level を、値の順位から直接
  求める。
- どちらも、表示中の範囲 (region) と間引き (step) の格子点で数える。
- tutorial の例: `vol #1 enclose 1e6 step 1` (EMD-1080、GroEL)。サブユニット 14 個 × 約 57 kDa ≈ 800 kDa。
  タンパク質の体積は分子量からおよそ 1.21 Å³/Da で見積もれるので、約 1×10⁶ Å³ になる。

## CueMol で使えるもの

- `DensityMap::getLevelAtTopFraction(frac)` / `getTopFractionAtLevel(level)` (`src/modules/xtal/DensityMap.cpp`): 8 bit の
  histogram から、上位の割合と level を相互に変換する。EM map の level (`siglevel` = 上位 N%) はこれで解決している。
- 体積 V を囲む割合は f = V ÷ (1 格子点の体積 × 全格子点数)。`fastEncloseVolume` は、この 2 つでそのまま再現できる。
- 等値面が囲む体積を測る仕組みは無い。そのため `encloseVolume` (面の体積で二分探索) も、格子点の数による近似に
  なる。ふつうは差が小さいが、近似として spec に書く。

## 変更の案

### libcuemol2

- `DensityMap` に 2 つ足し、`DensityMap.qif` で公開する:
  - `getVoxelVolume()`: 1 格子点の体積 (Å³)。単位胞の体積 ÷ (列・行・断面の格子間隔の積) で求める。
  - `getLevelForEnclosedVolume(volume)`: `getLevelAtTopFraction(volume / (getVoxelVolume() × 全格子点数))`。
  - `getEnclosedVolumeAtLevel(level)`: `getTopFractionAtLevel(level) × 全格子点数 × getVoxelVolume()`。
- 数え方は map 全体の格子点 (ChimeraX のように表示範囲・間引きでは数えない)。これは差として spec に書く。

### GUI (Density map pane)

- EM map の Level の欄の下の説明 (今は同じ level を別の単位で示している) に、その level で囲む体積
  (例 `≈ 1.0×10⁶ Å³ (≈ 830 kDa)`) を足す。
- 体積または分子量 (kDa) を入れて level を決める入力を足す。form-kit のカタログ (`h3-kit/form/`) の既存部品で組む。
  置き場所と見せ方 (Level の欄の単位切り替えに加えるか、別の行にするか) は、着手時に UI の案を作って決める。
- 書き込みは今の level と同じ経路 (`level` を書くと、C++ が map kind で `siglevel` に変換する)。

### ChX console

- `volume #N encloseVolume V` / `fastEncloseVolume V`: `getLevelForEnclosedVolume(V)` で level を求めて適用する。
  `VOLUME_REFUSED` から外す。`encloseVolume` は近似であることを spec に書く。
- 複数の値 (`encloseVolume 1e6,2e6`) は、今の `surfaceLevels` と同じく 1 つ目だけを使って warning を出す。

### PyM console / op

- 必要になれば、`set_map_contour` か新しい op に「体積で指定」を足す。今回の範囲では op は増やさない
  (ChX と GUI は worker の service から呼ぶ)。

## テスト (最小限)

- C++: 大きさの分かる合成 map で、`getLevelForEnclosedVolume` と `getEnclosedVolumeAtLevel` が互いに戻ること、
  1 格子点の体積が単位胞と格子間隔から正しく出ること。
- ChX: `volume encloseVolume` が、求めた level を書くこと。

## 未決

- GUI の入力の形 (体積か分子量か、両方か。単位の切り替え)。
- 正確な方法 (等値面の体積で二分探索) を、C++ の marching cubes の結果から測って実装するかどうか。必要性は、
  近似との差を実データで見てから決める。

---

# 2. 原子モデルから密度 map を作る (`molmap`)

原子モデル (MolCoord) から、指定した分解能の模擬的な密度 map を作る。電顕 map とモデルの比較 (差分 map、当てはめの
確認)、低分解能での見え方の確認、図の作成に使う。quickstart では `molmap #2 10` (1grl から 10Å の模擬 map) と、それを
使った差分 map (`vol subtract #1 #3 minrms t`) が出てくる。

## ChimeraX の機能

`map/src/molmap.py` の `molmap`:
- 各原子に、原子番号を重みにしたガウス関数を置き、その和を格子に書く。
- 標準偏差 = 分解能 × `sigmaFactor` (既定 1/(π√2) ≈ 0.225)。
- 格子間隔は既定で分解能の 1/3 (`gridSpacing`)、原子の範囲の周りに分解能の 3 倍の余白 (`edgePadding`)。
- 各ガウス関数は標準偏差の 5 倍 (`cutoffRange`) で打ち切る。
- `balls true` でガウス関数の代わりに球を使う。
- 結果は新しい map の model になる。

## CueMol で使えるもの

- 原子から密度を作る仕組みはまだ無い。
- `DensityMap` は、値の配列と格子の情報を外から与えて作れる (`setMapFloatArray`、`setMapParams`、`setXtalParams`、
  `src/modules/xtal/DensityMap.hpp`)。電顕 map と同じく、単位胞 = 格子の箱、空間群 P1、`map_type = em` として作る。

## 変更の案

- **libcuemol2**: 原子の選択と分解能などから `DensityMap` を作る関数 (例 `MolCoord` から呼べる builder) を足し、qif で
  公開する。ガウス関数の和は、各原子について打ち切り半径の中の格子点だけを足す (原子数 × 半径内の格子点数)。大きな
  分子でも数秒以内を目安にし、必要なら並列化する (`qlib/parallel.hpp`)。
- **op / GUI**: map を作る op (`make_density_map` のようなもの) と、object のメニューか Density map 関連の pane からの
  入口。入口の形は着手時に UI の案を作って決める。
- **ChX console**: `molmap <atoms> <resolution> [gridSpacing] [edgePadding] [sigmaFactor] [cutoffRange]`。新しい map の
  model を作り、ChimeraX と同じく次の既定色で表示する。

## 関連して検討するもの (比較で出てきたもの)

- **map 同士の演算** (`vol subtract` など、新しい map を作る演算): 模擬 map との差分に使う。`minrms` (差が最小になる
  ように尺度を合わせる) を含む。今は ChX で断っている (飛ばして続ける)。
- **`fitmap`** (原子モデルを map に当てはめて動かす): 最適化と、model の座標を変換する仕組みが要る。quickstart の
  `fit #2 in #1` で 1grl が map の中に入る。

## テスト (最小限)

- C++: 原子 1 個から作った map で、ピークの位置が原子の座標に、広がりが指定した標準偏差に一致すること。

