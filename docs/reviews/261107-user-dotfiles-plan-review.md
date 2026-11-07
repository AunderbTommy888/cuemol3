# User dotfiles 計画レビュー（更新版）

対象: [261107-user-dotfiles-plan.md](../plans/261107-user-dotfiles-plan.md)  
レビュー日: 2026-11-07（第 3 回レビュー・追加確認）

**これまでの指摘は計画上で対処されていますが、追加確認で実益のある指摘を 2 件確認しました。** 前回指摘の対応確認に加え、CLI からの起動と `.qax` の実行経路を照合した結果です。先に述べた「追加指摘なし」という判断を訂正します。

## 1. [P2] CLI のコマンド実行も startup gate で待たせる

対象: 実装 3、136–151 行（startup gate）。

計画で gate を待つのは `useShellOpenFiles` だけですが、`tritium_cli` はそこを通らず、`useConsoleEndpoint` から直接 `runSubmission` を呼びます。endpoint の有効条件は `cm !== null` とアクセス許可で、rc の完了を待ちません。CLI も接続情報に endpoint が現れると起動完了と判断します。

このため、CLI がアプリを起動し、rc が fetch している間に利用者のコマンドを送ると、worker の `txnBusy()` により利用者のコマンドが拒否されます。逆に CLI のコマンドが先に transaction を開始すると、rc の側が拒否される可能性があります。接続先のパスを揃えるだけでは、CLI から起動する通常の使い方が安定しません。

**修正案:** `useConsoleEndpoint` の `run` 要求も startup gate の終了を待ってから実行する。既存の `info` 応答などと分け、待機中にクライアントが取消した場合は、gate が開いてもその要求を実行しない。少なくとも「CLI が起動したアプリでも rc → 利用者のコマンドの順になる」を計画の実行順序に含める。

根拠: [useConsoleEndpoint.ts](../../tritium/react-gui/src/plugins/console/renderer/useConsoleEndpoint.ts) の endpoint 有効条件と `runSubmission` 呼出し、[connection.ts](../../tritium/cli/src/connection.ts) の `ensureApp`、[runCommand.ts](../../tritium/react-gui/src/plugins/console/worker/runtime/runCommand.ts) の `txnBusy()` による拒否。

## 2. [P2] `.qax` にも rc ディレクトリの cwd を明示する

対象: 仕様 30–33 行、実装 3 の 93–99 行・115–118 行。

仕様では全 rc の相対パスをファイルのディレクトリから解決しますが、実装手順で cwd の設定を記載しているのは「qax 以外」の分岐だけです。既存の `runQaxStandalone()` は `workDirFor(args)` を使い、`cwd` が渡されなければ console の現在ディレクトリを使います。qax ファイル自体を絶対パスで開いても、その中のコマンドの基準ディレクトリは変わりません。

たとえば `~/.cuemol/startup.qax` 内の `<cmd>` で相対パスの PDB を load する場合、qax の経路をそのまま再利用すると、`~/.cuemol/` ではなくアプリの起動ディレクトリなどから探して失敗します。先に実行する `startup.txt` の有無や cwd の扱いにも依存させるべきではありません。

**修正案:** startup 用の runner が、各ファイルの実行開始時に `cwd = dirname(scriptPath)` を明示して `runSubmission` へ渡す、と記載する。これを `.qax` にも適用すれば、既存 qax の「1 action = 1 undo」を維持しながら、全 rc で同じパス解決の契約を満たせます。

根拠: [runCommand.ts](../../tritium/react-gui/src/plugins/console/worker/runtime/runCommand.ts) の `workDirFor`（85 行以降）、`runQaxStandalone`（449 行以降）、`runScriptPath` の qax 呼出し。

## 前回指摘の対応確認

前回残っていた Stop の接続は、計画上で解消しています。`useConsoleRunner` の共通経路を使い、次の処理が明記されました。

- `consoleSession.begin()` による Stop の表示と Undo/Redo の抑止。
- `runIdRef` と `stoppedRef` による、実行中の rc とシーン操作後の継続の停止。
- Stop では残りの startup ファイルも中止し、通常のコマンドエラーとは区別。
- `runSubmission` が戻ってから gate を release。

初回の 6 件（予約 ID、継続時の再送、接続先の統一、timeout、起動につき 1 回、style 読込失敗時の後始末）への対処も維持されています。

## 確認範囲

更新後の計画全文と、console の実行・停止、CLI の起動・要求送信、qax の cwd 解決を静的に照合しました。判定は計画への対応を示し、実装済みを意味しません。上記の不具合例はコードから導いたもので、アプリで再現試験した結果ではありません。計画本文と実装コードは変更せず、レビュー文書のみ更新しました。
