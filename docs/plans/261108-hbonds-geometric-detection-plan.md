# 水素結合の検出: ChimeraX の `hbonds` を参考に、CueMol の相互作用の抽出を改善する

**未着手**。関連: [261107-chx-tutorial-survey-plan.md](261107-chx-tutorial-survey-plan.md) (`hbonds` は 7 本の tutorial
で使われる)、[console-chimerax-dialect](../architecture/console-chimerax-dialect.md)。

## Context

ChimeraX の tutorial を ChX console で比べると、`hbonds` は 7 本の tutorial で使われる重要なコマンドだが、ChX には無い
(今は未対応として飛ばす)。CueMol にも相互作用の抽出 (`analyze_interactions`、GUI の Interaction Analysis) があるが、
距離だけの単純な判定で、水素結合を正しく拾えない。ChimeraX の判定方法のうち、無理なく取り入れられる部分で CueMol の
抽出を改善し、その上で ChX の `hbonds` / `~hbonds` を作る。

## 今の CueMol

- `analyze_interactions` op (`catalog/ops/analysisOps.ts`) → service `services/molops/analyzeInteractions.ts` →
  C++ `MolAnlManager::calcAtomContact{,2,3}JSON` (`src/modules/molanl/ContactMap.cpp`)。
- 判定は距離だけ (BSP tree で rmin〜rmax の原子の対)。角度の判定は無い。水素は常に飛ばす。「水素結合のみ」
  (`hbondOnly`) は炭素を除くだけで、供与体・受容体の区別は無い (S、P、ハロゲン、金属も拾う)。
- 同じ分子のときは同じ残基の対と、共有結合した対を除く (1-3 の対は除かない)。2 分子のときはその除外も無い。
- 小さな不具合: 上限の判定が `i > nMax` で 1 件多く通る。出力の順が原子 id 順 (距離順でない)。
- 結果は `atomintr` renderer に原子の対として入る (`appendById`)。破線・色・距離のラベルは renderer の property。
- **使える部品** (今は使われていない):
  - `data/default_params.xml` の原子型ごとの `hbon=` (D 供与体 / A 受容体 / B 両方 / H 極性 H / N なし) と `hybr=`
    (sp1/sp2/sp3)。`TopparManager::getParamDB()->getAtom(type)` で引ける。
  - 残基のトポロジー (`data/prot_top.xml` など。原子名 → 原子型、結合)。`MolResidue::getTopologyObj()`。
  - 結合の情報 (`MolBond`)。主鎖の水素結合は DSSP の実装 (`Prot2ndry.cpp` の `calcHbon`) に、主鎖の NH の H の
    位置の計算がある。

## ChimeraX の `hbonds` (参考にする部分)

ChimeraX のソースの `bundles/hbonds/src/hbond.py` ほか。Mills & Dean (1996) の基準。
- 供与体・受容体の種類 (IDATM 型) ごとに、距離と角度の閾値の表を持つ。
- 水素があれば H…A の距離と D-H…A の角度 (θ、120〜150°) で判定。水素が無ければ、位置が決まる H (主鎖の NH、環の NH)
  は計算で置き、回転できる H (OH、NH3+) は重原子だけの基準 (D…A の距離と、D の結合相手-D…A の角度) で判定。
- 受容体側も、A の結合相手-A…D の角度の下限を見る。
- 既定で余裕を持たせる (`relax true`: 距離 +0.4Å、角度 -20°)。硫黄は距離を +0.35Å。金属に配位した受容体は除く。
- 表示: 疑似結合の破線 (deep sky blue、半径 0.075、6 分割)。H があれば H から、無ければ重原子から引く。`showDist` で
  距離のラベル。`reveal` で端の原子の側鎖を表示。`~hbonds` で消す。
- 標準残基の型は小さな表 (`.idatmres`) から決め、それ以外 (リガンド) は形から型を推定する (2400 行の C++)。

## 方針 (取り入れる範囲)

ChimeraX の調査で「タンパク質の結果のほとんどを再現できる最小の部分集合」とされたものを取り入れる。

1. **供与体・受容体の分類**: 原子型 (残基のトポロジー) の `hbon` / `hybr` を使う。トポロジーの無い残基 (リガンドの
   HETATM) は、元素と結合からの簡易な判定 (O は受容体、H の付いた O / N と水は供与体、H の付いていない N は結合数で)
   にする。ChimeraX の形からの型の推定は移さない。
2. **水素の扱い**: 水素があれば使う。無ければ、主鎖の NH の H だけ計算で置く (DSSP と同じ置き方)。それ以外は重原子
   だけの基準にする。
3. **判定**: 供与体の種類 (固定の H / 回転できる H / 水) と受容体の種類 (sp2 O / sp3 O・平面 N / sp3 N / S) の組で、
   ChimeraX の表の値を使う。
   - H があるとき: H…A ≤ 閾値 + 0.4、D-H…A ≥ θ − 20。
   - H が無いとき: D…A ≤ 閾値 + 0.4、D の結合相手-D…A ≥ υ − 20。
   - 受容体: A の結合相手-A…D ≥ 90 − 20。硫黄は距離 +0.35。
   - 余裕 (0.4Å / 20°) は引数で変えられ、0 にもできる (`relax false`)。
   - 移さないもの: carbonyl の syn/anti、phi の面、tau の判定。これらを外すと判定が少し緩くなる方向に効く。
4. **C++**: `src/modules/molanl/` に水素結合の検出 (例 `HBondFinder`) を足し、`MolAnlManager` から呼べる
   `calcHBondJSON` (1 分子 / 2 つの選択 / 2 分子) を qif で公開する。結果は
   `[{donor, acceptor, hydrogen?, dDA, dHA?}, ...]` を距離順で返す。今の `ContactMap` は「接触」として残し、上の
   小さな不具合 (上限の 1 件多い、順序) も直す。
5. **op と GUI**:
   - `analyze_interactions` に判定の方法の引数 (`method`: `contact` (今の距離だけ) / `hbond` (新しい判定)) を足す。
     既存の `includeCarbon` は `contact` の時だけ使う。`hbond` は余裕 (`distSlop` / `angleSlop`) を取る。
   - GUI の Interaction Analysis のダイアログ: 「Hydrogen bond (N, O) only」の checkbox を、判定の方法の選択
     (`Contact (distance)` / `Hydrogen bond (geometry)`) に置き換える。form-kit の `SegmentField` か `SelectField`
     で組む。
   - agent / MCP の tool の schema の固定 (`schemaPin` の snapshot) を更新する。
6. **ChX console**: `hbonds` と `~hbonds` (`hbonds delete`)。
   - `hbonds [atoms] [restrict cross|both|any|<spec>] [relax] [distSlop] [angleSlop] [interModel] [intraModel]
     [intraMol] [intraRes] [reveal] [showDist] [color] [dashes] [radius] [name] [log] [select]`。
   - `analyze_interactions` (`method: hbond`) を呼び、結果を `name` (既定 `hydrogen bonds`) に対応する `atomintr`
     renderer に入れる。色 deep sky blue、破線、ラベルは `showDist` の時だけ。`restrict` は 2 つの選択の形に写す。
   - `reveal true` は端の原子を含む残基を表示する (ChX の `show` と同じ表示の更新)。
   - `log true` は ChimeraX と同じ形の表 (供与体、受容体、水素、D…A、D-H…A) を出す。
   - `radius` は CueMol の線の太さに換算できないので無視して warn。`twoColors` / `saltOnly` / `saveFile` /
     `coordsets` などは未対応として warn。
   - `~hbonds [name]`: その renderer を消す。

## 作業の順

1. C++ の検出と gtest。
2. op の `method` と service。
3. ChX の `hbonds` / `~hbonds`。
4. GUI のダイアログ。
5. 比較: quickstart 以外で `hbonds` を使う tutorial (Binding Sites など) の該当行を ChimeraX と並べ、拾う対の数と
   位置を比べる (ChimeraX の `log true` の表と、CueMol の結果の表を突き合わせる)。

## テスト (最小限)

- C++: 小さな合成の構造で、(1) 主鎖の NH…O=C の対が、角度が良ければ拾われ、θ を外すと拾われないこと、
  (2) H の無い OH…O が重原子の基準で拾われること、(3) 炭素や、供与体どうしの対は拾われないこと。
- TS: `analyze_interactions` の `method: hbond` が新しい C++ を呼ぶこと (既存の service のテストに 1 件)。
- ChX: `hbonds` が `restrict` と `name` を op の引数と renderer に写し、`~hbonds` がその renderer を消すこと。

## 未決 (着手前に決める)

- GUI のダイアログの変更をこの作業に含めるか (含めない場合は C++ と op と ChX まで)。
- リガンド (トポロジーの無い残基) は簡易な判定でよいか。ChimeraX のような形からの型の推定は大きいので、今回は
  入れない案。
- tutorial の画像比較 (残りの tutorial を組ごとに流す作業) との順番。
