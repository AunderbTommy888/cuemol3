# ChX visual parity plan レビュー

- レビュー日: 2026-11-08
- 対象: `/Users/user1/proj64/cuemol2-chxfix/docs/plans/261108-chx-visual-parity-plan.md`
- 確認方法: 対象 worktree の現行コードとプランを照合。実行テストは行っていない。

実装前に補足したい点は以下の2件。

## 1. [P2] center view の fit は selection 設定後に実行する

対象: プラン82行目「center view で zoom も合わせる」。

現在の `tritium/react-gui/src/renderer/worker/server/services/rend/setupRenderer.ts` は、165行目で `recenterIfRequested` を呼んだ後、180–183行目で `rendOpts.selection` を renderer に設定している。関数の中身だけを `focusOnNode` に置き換えると、chain や ligand を指定して開いた場合も、設定前の selection で fit される。その結果、作成後に Focus ボタンを押した場合と構図が一致しない。

**提案:** 呼び出し位置も selection・初期設定の完了後へ移すことを計画に明記する。確認は「部分 selection＋center view」の1ケースで十分。

## 2. [P2] surface の色コピーに、コピー元が存在しない場合の方針を追加する

対象: プラン152行目「新しい surface」。

GUI で分子を開いてから ChX の `surface #1` を実行する経路では、`chx:cartoon` も atom renderer も存在しないことがある。現行の surface 作成経路は `ensureOwned` を呼ばない。また、`list_paint` は非 PaintColoring に対して空表ではなくエラーを返す。「cartoon の表が空なら atom の表」という分岐だけでは、現在使えるこの操作を失敗させるおそれがある。

確認した実装:

- `tritium/react-gui/src/plugins/chimerax-console/worker/surface.ts`: `makeSurface` / `showSurfaces`
- `tritium/react-gui/src/plugins/chimerax-console/worker/commands/displayCommands.ts`: surface の表示経路は `ensureOwned` より前に処理される。
- `tritium/react-gui/src/renderer/worker/server/catalog/ops/editOps.ts`: `paintEntries` は非 PaintColoring をエラーにする。

**提案:** コピー元がない／paint でない場合は既存の surface 既定色を維持するなど、フォールバックを明記する。コピー元を確定する前に、コピー先を clear しない順序にする。

明記済みの近似や対象外項目については、追加の指摘なし。
