# 視点の fit (Focus と center view)

scene tree の Focus ボタン、object や renderer を開いたときの center view、ChX console の最初の `open` が、対象に視点を
合わせる (中心と zoom、slab) ときの規則。どれも同じ関数 (`services/sceneTree/sceneOps.ts` の `focusOnNode` /
`focusOnNodes`) を通る。

## 何に合わせるか

- **分子の object**: 表示中の renderer (`visible`) が描く原子に合わせる (`displayedSel`)。ChimeraX が表示中のもの
  (`drawing_bounds`) に合わせるのと同じ考え方で、表示していない部分 (隠した水など) に合わせても意味が薄いため。
  - 表示中の renderer の `sel` を `(a) or (b)` で結び、`makeSel` で作る。`dsurface` は `showsel` との積。
  - renderer の既定の選択は空の `SelCommand` で、`toString()` は空文字列だが全原子を選ぶ (`SelCommand.cpp`)。結ぶ前に
    空文字列は `*` にする (`() or (...)` という不正な式にしない)。
  - 表示中の renderer が 1 つも無いとき、または表示中の選択に原子が無いときは、全原子に合わせる
    (`MolCoord::fitView`)。「何も表示していない」と「選択が空文字列 (= 全原子)」は別。
- **renderer / renderer group**: その renderer の `sel` (`MolCoord::fitView2`)。group は分子全体。
- **地図の object**: 表示中の等値面の範囲 ([cryo-em-map-mode](cryo-em-map-mode.md) の「地図への fit」)。
- **複数の node** (`focusOnNodes`): 各 node の箱 (上と同じもの) の和に `View::fitToBox` で合わせる。node が 1 つなら
  `focusOnNode`。

## 大きさ

- 箱は各辺を 20% 広げる (`MolCoord::getFitBox`、地図も `mapFit.ts` で同じ値)。
- `View::fitToBox` (`src/qsys/View.cpp`): 箱の中心を view の中心にし、縦横比を見て zoom (表示の高さ) を決め、slab を
  箱の奥行きにする。
  - どの軸も最低 `FIT_MIN_EXTENT` (4 Å) に広げる (大きさの無い箱で 0 除算しないため)。
  - zoom の下限は `FIT_MIN_ZOOM` (15 Å)。原子 1 個や小さな ligand を開いたときに、それだけが画面いっぱいに写らない
    ように、周りの数残基が入る大きさにする。地図の `DensityMap::fitView` も同じ下限を使う。
- ChimeraX の fit (視錐台に箱の角を収め、窓の 5% の余白) との差は
  [console-chimerax-dialect](console-chimerax-dialect.md) の「open の視点」に書いた。

## center view (開いたとき)

- open ダイアログの center view、op の `centerView: true` (native console、MCP、`fetch_entry` など) は、新しい renderer に
  Focus と同じ fit (中心と zoom) をかける (`services/rend/setupRenderer.ts` の `fitViewsIfRequested`。scene の各 view に
  `focusOnNode`)。以前は中心だけを移していたので、分子の大きさによって写りが大きすぎたり小さすぎたりした。
  - renderer の selection と `molPostProc` などの初期設定が済んだ後に呼ぶ。chain などを指定して開いたとき、その部分に
    合う (作成後に Focus を押したときと同じ構図)。
  - renderer の作成の一部なので記録しない (`record: false`。[action-log](action-log.md))。
  - 地図は除く (視点は `applyMapCenterPolicy` が決める)。
- ChX の `open` は、ChimeraX に合わせて最初の model のときだけ合わせ、2 つ目以降は `centerView: false` で開く
  ([console-chimerax-dialect](console-chimerax-dialect.md))。

## テスト

- C++: `src/tests/modules/molstr/test_selscope_fitview.cpp` (原子 1 個の fit が `FIT_MIN_ZOOM`)、
  `src/tests/modules/xtal/test_maprenderer_region.cpp` (地図のデータの箱と、level 以上の格子点の箱)。
- TS: `renderer/__test__/sceneOpsService.test.ts` (表示中の renderer だけ、空の選択は全原子)、
  `renderer/__test__/setupRendererService.test.ts` (center view は selection の設定の後に各 view に fit)。
