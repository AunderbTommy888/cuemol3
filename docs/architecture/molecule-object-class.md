# 分子の object の判定と `Trajectory`

scene の object が「分子」かどうかを、クラス名から決める規則。

## 判定

`worker/shared/objectClasses.ts` の `isMoleculeClass(className)` が、両方のスレッドで使う 1 つの判定:

- `MolCoord`、名前が `Mol` で終わるクラス (`PDBMol`、`MmCifMol`、`MorphMol` など)、`Trajectory` を分子とする。
- `Trajectory` (MD trajectory。C++ の `mdtools::Trajectory`) は `AnimMol` を通して `MolCoord` を継承するが、名前が
  `Mol` で終わらないので、名前で明示する。UXP は `cuemol.implIface(type, "MolCoord")` で判定していて、
  `Trajectory` も分子に含まれていた。
- クラスが分からないものは分子にしない (厳しい判定)。File Open が使う `isMolObjectClass` (地図でなければ分子とみなす
  緩い判定) とは目的が違うので、別の関数にしている。

この判定を使う場所:
- 既定の色の順番 (`defPaintColoring.ts` の `paletteColorOf`。[default-paint-palette.md](default-paint-palette.md))
- 分子の色で塗るときの既定の参照分子 (`colorTargets.ts` の `findFirstMolCoordName`)
- Symmetry パネルの `isMol` (`symmetryPanelOps.ts`)
- renderer の selection の評価先の分子 (`props/selContext.ts`)
- UI の分子の選択 (`h3-kit/ObjectSelect.tsx` の `objectFilters.molCoord`。ColorPane の「Coloring mol」、Selection
  pane、MolStruct pane、`MolPicker` を使うダイアログなど)

pymol / chimerax console の helper (`plugins/pymol-console/worker/commands/helpers.ts`、
`plugins/chimerax-console/worker/models.ts`) は、まだ自前の判定 (`MolCoord` か `...Mol`) のままで、`Trajectory` を
含めていない。

## `Trajectory` を断る操作

`Trajectory` は、固定のトポロジーを前提に各 frame の座標の配列と原子を対応付けている。原子を足したり消したりする
操作はこの対応を崩す。`Trajectory::removeAtom` は例外を投げて断るが、`MolCoord::deleteAtoms` は `removeAtoms()` を
通るので、この拒否を通らずに原子を消せてしまう。また、superpose と morph は `Trajectory` に対して意味がはっきり
しない。そのため、次の操作では `Trajectory` を UI と service の両方で断る:

| 操作 | UI | service |
|---|---|---|
| Superpose | 初期選択の候補と Reference / Moving の `MolPicker` | `superposeMol` |
| Morph | target と「Add mol...」の一覧 | `convertToMorphMol`、`addMorphFrameFromMol` |
| 原子の削除 | `DeleteMolDialog` の `MolPicker` | `deleteMolAtoms` |
| Merge | `MergeMolDialog` の From と To の両方 | `mergeMol` (Copy / Move を問わない) |

- UI は `objectFilters.molCoordNotTraj` (= `molCoord` かつ `Trajectory` ではない) で一覧から外す。`MolPicker` の
  省略可の `filter` prop で渡す (既定は `objectFilters.molCoord`)。
- service は `helpers/refuseTrajectory.ts` の `refuseTrajectory(obj, what)` で `fail(..., 'unsupported')` を返す。op や
  console から来ても断るため。
- Merge の From からの Copy は今の frame を読むだけで動くかもしれないが、行う意味が薄く危険なので断っている。
- chain 名の変更、残基番号の変更、二次構造の再割り当て、分子表面、APBS、相互作用の解析は、原子の数を変えないので
  `Trajectory` を許す (chain 名の変更は残基を chain の間で付け替えるだけ)。
