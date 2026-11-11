# 分子の判定から `Trajectory` が漏れている件の修正

既存の分子に renderer を足すと `mol.coloring` が初期化される不具合の review (`newObj` の修正。仕様は
`../architecture/default-paint-palette.md`) で見つかった、別件の不具合。

## 直すこと

`Trajectory` の既定の色が、常にパレットの先頭の色になる。`defPaintColoring.ts` の `paletteColorOf` は分子を
`className === 'MolCoord' || className.endsWith('Mol')` で数えるが、`Trajectory` (C++ では `AnimMol` を通して
`MolCoord` を継承する) はこの条件に当たらない。そのため `indexOf` が -1 になって先頭の色を取り、後から読んだ分子の
色の順からも数えられない。

- 同じ判定のコピーが他にもあり、`Trajectory` を含めているのは `props/selContext.ts` の `isMoleculeClass` だけ:
  - worker: `colorTargets.ts`、`symmetryPanelOps.ts`、pymol / chimerax console の helper。
  - UI: `h3-kit/ObjectSelect.tsx` の `molCoord` フィルタ。`useMolCoordObjects.ts` を通して ColorPane の「Coloring mol」
    の候補になる。そのため、surface / isosurf を分子の色で塗るときに `Trajectory` を参照の分子に選べない (分子が
    `Trajectory` だけだと選択欄が無効になる)。C++ 側は参照の分子を `MolCoord` として扱うので、UI の判定とずれて
    いる。同じフィルタは Selection pane、MolStruct pane などでも使っている。
- 直し方: `worker/shared/objectClasses.ts` (両方のスレッドから読める) に `isMoleculeClass` を移し、`paletteColorOf`
  はそれを使う。他のコピー (UI を含む) も置き換えるかは、使っている場所ごとに `Trajectory` を分子として扱えるか
  確かめてから決める。
- テスト: 既存の `defPaintColoring.test.ts` を拡張して、`Trajectory` が分子として数えられ、地図は数えられないこと
  を確かめる。

