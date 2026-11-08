# ChX visual parity plan 追加レビュー

- レビュー日: 2026-11-08
- 対象: `/Users/user1/proj64/cuemol2-chxfix/docs/plans/261108-chx-visual-parity-plan.md`
- 確認方法: 対象 worktree の現行コードと更新後のプランを照合。変更後の実行検証は行っていない。
- 前回のレビュー: [261108-chx-visual-parity-plan-review.md](261108-chx-visual-parity-plan-review.md)

前回の2件はプランに反映されている。追加で、実装時に対処した方がよい点は以下の2件。

## 1. [P2] 部分的な fromatoms でも、コピー先が非 PaintColoring だと表面全体の色が変わる

対象: プラン154行目「範囲を限った上書き」。

GUI で分子を開き、次の順に操作すると該当する。

```text
surface #1
color #1:10 red target a
color #1:10 fromatoms
```

最初の surface は今回追加されたフォールバックにより `DefaultCPKColoring` のままになる。その後の部分コピーで `ensurePaint` を呼ぶと、`tritium/react-gui/src/renderer/worker/server/services/coloring/applyColoring.ts` の299行目以降が表面全体を既定の二次構造別 paint に切り替えるため、指定していない残基の色まで変わる。コピー元の存在確認だけでは防げない。

**修正案:** コピー先についても判定し、部分コピーでは対象外の色を保持する。今回そこまで対応しないなら、非 PaintColoring のコピー先への部分コピーは変更せず warn する方針を明記する。

## 2. [P2] Focus の selection 結合では、空文字列を「全原子」として扱う

対象: プラン78行目「selection を `(a) or (b)` で結ぶ」。

通常の renderer の既定 selection は、`toString()` が空文字列でも全原子を選択する。このまま `(a) or (b)` に結合すると `() or (...)` になり、不正な選択式になる。`dsurface` の既定 `showsel` も空文字列なので、積を作る場合も同様。GUI で selection を指定せずに作った renderer で発生する条件である。

確認した実装:

- `src/modules/molstr/MolRenderer.qif`: 既定 selection は空の `SelCommand`。
- `src/modules/molstr/SelCommand.cpp`: 未設定の selection は `toString()` が空文字列で、`isSelected()` は true を返す。
- `tritium/react-gui/src/renderer/worker/server/services/helpers/makeSel.ts`: 非空の文字列は compile し、失敗時は null を返す。
- `tritium/react-gui/src/plugins/chimerax-console/worker/display.ts` の `readSel` と `surface.ts` の `readShowSel`: 空文字列を `*` に変換している。

**修正案:** 結合前に空文字列を `*` に変換する。「何も表示していない」と空文字列を混同しないことも明記する。
