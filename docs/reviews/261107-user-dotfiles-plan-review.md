# User dotfiles 計画レビュー（更新版）

対象: [261107-user-dotfiles-plan.md](../plans/261107-user-dotfiles-plan.md)  
レビュー日: 2026-11-07（第 4 回レビュー）

**前回の 2 件は計画上で対処されています。関連経路も見直し、追加で修正する実益がある指摘は 1 件です。** rc 実行中に Console plugin を無効にした場合の扱いが不足しています。

## 1. [P2] rc 実行中は、ConsoleRoot をそのまま unmount しない

対象: 実装 3、118–134 行・143–148 行。

計画では `useConsoleRunner` に Stop と Undo/Redo 抑止を担わせますが、Console plugin を off にすると、その hook を持つ Root 自体が unmount されます。現行の cleanup は `consoleSession.reset()` を呼ぶだけで、worker の実行は取り消しません。一方、`useSuppressUndoRedo` は unmount 時にロックを解放します。

したがって、長い fetch を含む rc の実行中に Settings で Console を off にすると、worker の transaction は続いたまま、Stop が使えなくなり、Undo/Redo の抑止も外れます。再度 on にしても新しい runner の `runIdRef` は空なので、元の rc を止められません。計画にある「claim 前の unmount では保留を外す」処理と「再 mount では再実行しない」処理だけでは、この実行中のケースを扱えません。

**修正案:** 最小の対応として、rc 実行中は Console plugin の無効化を保留し、Stop または正常終了で `runSubmission` が戻ってから無効化する。無効化操作を中止要求として扱う場合も、先に `cancelRun` を送り、処理が戻るまで runner と Undo/Redo 抑止を維持する。gate も同じ終了時点まで維持する。実行中に off → on を試しても、取消対象とロックが失われないことを既存の起動・停止確認に含める。

根拠: [PluginRoots.tsx](../../tritium/react-gui/src/renderer/plugin-host/PluginRoots.tsx) の active plugin の mount、[useConsoleRunner.ts](../../tritium/react-gui/src/plugins/console/renderer/useConsoleRunner.ts) の unmount cleanup と `runIdRef`、[UndoRedoLockContext.tsx](../../tritium/react-gui/src/renderer/contexts/UndoRedoLockContext.tsx) の `useSuppressUndoRedo`、[SettingsPane.tsx](../../tritium/react-gui/src/renderer/features/settings/SettingsPane.tsx) の plugin 切替処理。

## 前回指摘の対応確認

| 前回の指摘 | 更新後の計画 | 判定 |
|---|---|---|
| CLI のコマンドが rc と競合する | endpoint の `run` も `startupSettled()` を待ち、待機中に取り消された要求は実行しない。実行順序・確認項目・テストに反映 | 計画上で解消 |
| `.qax` の相対パスが rc のディレクトリ基準にならない | 各ファイルの開始時に `cwd = dirname(scriptPath)` を明示し、`.qax` にも適用。先行ファイルの cwd に依存させない | 計画上で解消 |

それ以前の指摘への対処（予約 ID、継続時の再送、main / CLI の接続先統一、timeout、起動につき 1 回、style 読込失敗時の後始末、Stop の接続）も維持されています。

## 追加確認と範囲

前回の修正箇所だけでなく、起動条件、plugin 設定の読込と切替、CLI の待機中の取消、text / qax の cwd と継続実行、style の読込・失敗時の削除・GUI 設定の保存を見直しました。この確認範囲では、上記以外に追加で修正を求める実益のある問題は見つかりませんでした。

静的レビューであり、判定は計画への対応を示します。実装済み・動作検証済みを意味しません。ビルド、アプリでの再現試験は行っていません。計画本文と実装コードは変更せず、レビュー文書のみ更新しました。
