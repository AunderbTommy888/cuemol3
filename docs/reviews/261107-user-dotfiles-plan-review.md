# User dotfiles 計画レビュー（更新版）

対象: [261107-user-dotfiles-plan.md](../plans/261107-user-dotfiles-plan.md)  
レビュー日: 2026-11-07（第 2 回レビュー）

**前回の 6 件は計画上で対処されています。追加で修正する実益がある指摘は 1 件です。** 実行中の timeout をなくす方針は妥当ですが、代わりに使う Stop を起動スクリプトへ接続する処理が不足しています。

## 1. [P2] 起動スクリプトを console の実行状態・Stop に接続する

対象: 実装 3、115–117 行、136–140 行。

計画は `useStartupScripts` から `runSubmission()` を直接呼び、終了後に `consoleSession.append()` で結果を追記します。しかし、`runSubmission()` 自体は console の実行状態や Stop の取消対象を登録しません。

現在の実装では、Stop は `consoleSession.running` が true のときだけ表示され、押すと `useConsoleRunner` が保持する `runIdRef` の実行を取り消します。`append()` は `running` を変更せず、起動スクリプトの `startup-N` もその ref に入りません。そのため、記載された経路のままでは rc 実行中に Stop が表示されず、単に `running` を true にしても rc を取り消せません。長い fetch を止めて shell open を進める、という今回の対処が成立しません。また、通常の runner が行う実行中の Undo/Redo 抑止も、この経路には適用されません。

**修正案:** 起動スクリプトも、実行中状態・取消対象の run ID・`stopped` フラグを管理する共通の仕組みに登録する。Stop から実行中の `startup-N` に `cancelRun` を送り、シーン操作後の継続にも停止状態を渡す。通常の console 実行と同様に Undo/Redo を抑止し、`runSubmission` が終了してから gate を release する。Stop 後に残りの startup ファイルを実行するかも明記する。起動処理全体を止める扱いなら、通常のコマンドエラーとは区別して残りを実行しない。

確認は「rc の実行中に Stop を押すと、その run ID が取り消され、終了前には gate が開かない」という境界の 1 ケースで足ります。

根拠: [useConsoleRunner.ts](../../tritium/react-gui/src/plugins/console/renderer/useConsoleRunner.ts) の `runIdRef` / `stop` / `useSuppressUndoRedo`、[consoleSessionStore.ts](../../tritium/react-gui/src/plugins/console/renderer/consoleSessionStore.ts) の `begin` / `append`、[ConsolePanel.tsx](../../tritium/react-gui/src/plugins/console/renderer/ConsolePanel.tsx) の Stop 表示条件、[runSubmission.ts](../../tritium/react-gui/src/plugins/console/renderer/runSubmission.ts)。

## 前回指摘の対応確認

| 前回の指摘 | 更新後の計画 | 判定 |
|---|---|---|
| dotfile の `id="user"` が GUI 設定を先取りする | 登録前に予約 ID と空 ID を拒否し、GUI 設定の読込・保存先を維持する | 計画上で解消 |
| text script の継続でファイルを先頭から再実行する | 成功後の継続では `scriptPath` を外し、`rest` と cwd を送る。未実行の `not-found` 再試行は区別 | 計画上で解消 |
| main と CLI の接続先が食い違う | 両方で `CUEMOL_LOCAL_API_INFO` → `CUEMOL_HOME` → 既定の順に解決する | 計画上で解消 |
| timeout で rc と shell open が並行する | 実行中には timeout を適用せず、終了後に release する | 元の問題は計画上で解消。Stop の接続は上記指摘 |
| plugin の再 mount で rc を再実行する | host 側の一度だけの claim と、`prefsLoaded` 後の対象確定に変更 | 計画上で解消 |
| style 読込失敗後に一部の定義が残る | 読込前後の UID 差分で、失敗時に追加された set を削除する | 計画上で解消 |

style の後始末に使う `getStyleSetsJSON(0)` は読込途中の set も列挙し、`destroyStyleSet(0, uid)` は名前ではなく UID で削除するため、今回の対処方法は現行 C++ の API と整合しています。

## 確認範囲

更新後の全文と前回レビューを比較し、今回の変更に関係する console の実行・停止経路と style の列挙・削除 API を静的に照合しました。判定は計画への対応を示し、実装済みを意味しません。ビルド、アプリの目視確認、再現試験は行っていません。計画本文と実装コードは変更せず、レビュー文書のみ更新しました。
