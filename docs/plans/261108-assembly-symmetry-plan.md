# 生物学的な会合体の対称 (mmCIF の対称操作) を表示する

mmCIF の `_pdbx_struct_oper_list` (対称操作の行列) と `_pdbx_struct_assembly_gen` (会合体ごとの行列の組み合わせと対象の
鎖) を読み、非対称単位の座標を増やさずに、会合体 (ウイルスの殻、多量体など) を複製として描けるようにする。結晶の
対称 (空間群と単位胞) ではない対称への対応で、ChimeraX の `sym #1 assembly N` に当たる。

**未着手 / 今後実装する**。

関連:
- [261107-chx-tutorial-survey-plan.md](261107-chx-tutorial-survey-plan.md) §6: quickstart の 17 行目
  `sym #1 assembly 3 newmodel false copies false` (2bbv のウイルスの殻) で、CueMol は非対称単位のまま残り、以降の絵が
  ChimeraX と違う。今は ChX で `sym` を未対応として飛ばしている。
- [261107-chx-tutorial-survey-plan.md](261107-chx-tutorial-survey-plan.md) §2: `sym` は「mmCIF の会合体の情報が要る」
  として挙げていた。
- 既存の `open <id> from rcsb_bio` (`worker/shared/dbSources.ts` の `assemblyFetch`) は、RCSB が作った会合体の座標
  ファイルを取得して、別の model として開く。座標が増える点で、ここで作るもの (複製を描くだけ) とは別。

---

## ChimeraX の機能

- `sym #1 assembly N`: mmCIF の会合体 N の対称操作を model に設定する。
  - `copies false` (既定): 座標を増やさず、複製を描く。`newmodel false` なら同じ model のまま。
  - `copies true`: 複製を別の model として作る (座標が増える)。
- `sym #1` (引数無し): 会合体の一覧を表示する。
- `sym clear`: 対称の表示を消す。
- `view` は複製も含めた範囲に合わせる。

## CueMol で使えるもの

- **`SymmRenderer`** (`src/modules/symm/SymmRenderer.cpp`): 同じ object の他の renderer を、行列のリストで複製して
  描く (`rendSymm`)。座標は増やさない。ChimeraX の `copies false` と同じ考え方。
  - 今の行列は、空間群と単位胞から作る結晶の対称だけ (`genByCell` / `genByExtent`、`CrystalInfo` の ext data、
    `SymOpDB`)。
- **mmCIF の reader** (`src/modules/importers/MmcifMolReader.cpp`): `_cell` と空間群は読んでいる。
  `_pdbx_struct_oper_list` / `_pdbx_struct_assembly_gen` は読んでいない。

## 変更の案

### libcuemol2

- **reader**: `MmcifMolReader` で `_pdbx_struct_oper_list` (id → 4×4 の行列) と `_pdbx_struct_assembly_gen`
  (会合体の id → `oper_expression` と `asym_id_list`) を読み、object の ext data (例 `AssemblyInfo`、`CrystalInfo` と
  同じ仕組み) に保存する。
  - `oper_expression` は `1-60`、`(1-5)(6-10)` (積)、`1,3,5` などの書き方があるので、展開して行列のリストにする。
  - `asym_id_list` は mmCIF の asym id (label_asym_id) で、CueMol の鎖名 (auth_asym_id のことが多い) と対応を取る必要が
    ある。reader で対応を記録する。
  - `.qsc` に保存するときの扱い (ext data の永続化) を決める。
- **`SymmRenderer`**: 行列の出どころを選ぶ mode を足す (`crystal` (今のもの) / `assembly`)。`assembly` のときは、
  ext data の会合体 N の行列を使う。
  - `asym_id_list` が鎖の一部だけを指す会合体は、鎖ごとに行列が違う。今の `SymmRenderer` は object の renderer を
    丸ごと複製するので、まず「すべての鎖に同じ行列」の会合体 (ウイルスの殻など、多くの場合) を正しく描き、鎖ごとに
    違うものは、対象の鎖だけを描く仕組み (renderer の選択の限定) を足すか、近似として扱うかを着手時に決める。
- **fit**: `view` / Focus が複製も含めた範囲に合うように、symm renderer の行列で原子の箱 (の角) を変換して和を取る。

### GUI

- 会合体の対称の表示の入口 (object のメニューか、renderer の追加で `symm` を選んだときに mode と会合体を選べる
  ようにする)。form-kit の部品で組む。
- 会合体の一覧 (id、構成、行列の数) を見せる。

### ChX console

- `sym #1 assembly N` (`copies false`): `assembly` mode の symm renderer を作る。`newmodel` は無視するか warning。
- `sym #1`: 会合体の一覧を表示する。
- `sym clear`: symm renderer を消す。
- `copies true`: 座標を増やすので、`open ... from rcsb_bio` と同じく会合体の座標を取得する形で近似するか、断る (飛ばす)。

## テスト (最小限)

- C++: `oper_expression` の展開 (範囲、積、列挙)、会合体の行列が mmCIF の値どおりに読まれること。
- C++: `assembly` mode の `SymmRenderer` が、会合体 N の行列の数だけ複製を描くこと (行列のリストの確認)。
- ChX: `sym #1 assembly N` が symm renderer を作ること。

## 未決

- `asym_id_list` が鎖の一部だけを指す会合体の扱い。
- ext data の `.qsc` への保存。
- GUI の入口の形。
