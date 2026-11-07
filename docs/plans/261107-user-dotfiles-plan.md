# ~/.cuemol/ dotfiles: 起動スクリプト (rc) と user style の読込

## Context

- 起動時に毎回同じ設定をしたいが、現状は手で打つしかない。PyMOL の `~/.pymolrc` のような
  run command ファイルを置き、起動時に console で自動実行したい。
- user style は現在 `app.getPath('userData')/user_styles.xml`
  (macOS: `~/Library/Application Support/<App>/`) にしかなく、場所が分かりにくい。しかもこの
  ファイルは GUI 設定 (DefaultLabel / UserViewConf) の保存先で、ウィンドウを閉じるたびに
  上書きされるので、手で書いた style を置く場所にはならない。
- 決定事項 (ユーザー回答):
  - 置き場所は `~/.cuemol/` (`~/.cuemol/local-api.json` で既に使われている dot dir)
  - rc は拡張子で dialect を判定し、存在するものを全部実行する
  - style は userData の `user_styles.xml` とは別に、read-only の追加ファイルとして読む

## 仕様

```
~/.cuemol/                        (env CUEMOL_HOME で差し替え可: dev/テスト用)
  startup.txt    native のコマンド行            -- 実行順 1
  startup.qax    native action (1 action = 1 undo) -- 2
  startup.pml    PyMOL dialect                  -- 3
  startup.cxc    ChimeraX dialect               -- 4
  styles/*.xml   追加 style (ファイル名順、read-only、global scope 0)
  local-api.json (既存)
```

- rc の実行タイミング: CueMol の初期化と最初の scene の作成が終わった後で、argv や
  open-file で渡されたファイルを開く前 (PyMOL と同じ順序)。対象は起動時の scene。
  `tritium_cli` から送られたコマンドも rc の後に実行する (CLI がアプリを起動した場合も、rc ->
  利用者のコマンドの順になる)。
- 相対パスは `~/.cuemol/` を基準に解決する (cwd = rc ファイルのディレクトリ。`.qax` も含め、全ファイルで
  同じ。前に実行したファイルの cwd や、console の今の cwd には依存しない)。1 ファイル
  = 1 submission = 1 undo txn (qax は既存挙動どおり 1 action ごと)。例外: rc の中で scene を変える
  コマンド (`create_scene`、`switch_scene` など) を使うと、手で打った submission と同じく、scene ごとに
  別の undo txn になる (undo は scene ごとのため)。
- rc は**アプリの起動につき 1 回**だけ実行する。起動時に console plugin が off だった場合や、起動後に
  console や dialect の plugin を off -> on にした場合は実行しない (起動時の設定を後から上書きしたり、
  分子を重ねて読んだりしないため)。
- 結果は console transcript に `[startup] ` prefix 付きで追記する (CLI の `[cli] ` と同じ方式)。
  1 ファイルでエラーが出ても残りのファイルは実行する。plugin が off の dialect の
  ファイルは実行せず、transcript に「skipped (PyMOL console plugin is off)」と出す。
- console plugin 自体が off なら rc は実行しない (native dialect も console plugin の一部のため)。
- style の優先順位: `system` < `cuemol3` < dotfile styles < `user` (GUI 設定)。GUI で変えた値が
  dotfile で隠れないようにする。各 XML には固有の空でない `<styles id="...">` が必要。読込に失敗した
  ファイル (id 重複・不正 XML・途中の定義の誤り) は warn ログを出して skip し、起動は止めない。
  **skip したファイルの定義は 1 つも残さない** (途中まで読めた定義も)。
- `id="user"` は GUI 設定の set の予約名なので、dotfile では読む前に断る (warn して skip)。dotfile が
  先に `user` を名乗ると、`user_styles.xml` の読込が id 重複で失敗し、終了時の保存 (`saveUserStyle` は
  名前 `user` で set を探す) が dotfile の内容で `user_styles.xml` を上書きしてしまうため。
  `user_styles.xml` をコピーして編集した dotfile でも起こるので、説明だけでなく読込側で保証する。
- `CUEMOL_HOME` は、rc・styles と、local API の接続情報 (`local-api.json`) の両方に効く。app (main) と
  `tritium_cli` は同じ規則で接続情報の場所を決める: `CUEMOL_LOCAL_API_INFO` -> `$CUEMOL_HOME/local-api.json`
  -> `~/.cuemol/local-api.json`。

## 実装

作業は develop から新ブランチ `feat/user-dotfiles` で行う。PR は 1 本にまとめる。

### 1. main: dot dir の解決とファイル列挙
- `tritium/react-gui/src/main/handlers/appPath.ts`
  - `getDotDir()` を追加: `process.env.CUEMOL_HOME || path.join(os.homedir(), '.cuemol')`
  - `listStartupScripts()`: 上の 4 つの候補のうち存在するものを、固定順の絶対パスで返す
  - `listDotStyleFiles()`: `styles/*.xml` を名前順に返す (ディレクトリが無ければ `[]`)
  - `IPC.APP_PATH` の返り値に `dotDir` / `startupScripts` / `dotStyleFiles` を追加する
- `tritium/react-gui/src/shared/types/appPath.ts` (`AppPathInfo`) に同じ 3 フィールドを追加する
- `main/localApi/index.ts:56` の `~/.cuemol` を `getDotDir()` に置き換える
  (`CUEMOL_LOCAL_API_INFO` の優先はそのまま)。
- `tritium/cli/src/connection.ts` の `infoFilePath()` も同じ順 (`CUEMOL_LOCAL_API_INFO` ->
  `$CUEMOL_HOME/local-api.json` -> 既定) にする。CLI は別 bundle なので関数は共有しないが、規則は同じに
  する。main だけが `CUEMOL_HOME` を見ると、`CUEMOL_HOME` 付きで起動したアプリの接続情報を CLI が
  読めず、既定の場所に別のアプリの情報があればそちらに接続してしまう。

### 2. dotfile styles の読込 (worker)
- `renderer/worker/server/workerLifecycle.ts` に `loadDotStyles(cm, paths)` を追加する。ファイルごとに:
  1. ファイルを読み、root の `<styles id="...">` を取り出す。id が空か `user` (予約名) なら、何も
     登録せずに warn して skip する。
  2. 読む前の global scope の set の uid を控え (`getStyleSetsJSON(0)`)、
     `stylem.loadStyleSetFromFile(0, p, true)` を try/catch で呼ぶ。
  3. 例外なら、控えに無い uid の set を `destroyStyleSet(0, uid)` で消してから warn して続ける。
     `StyleFile::loadNodes` は空の set を list の先頭に登録してから中身を読むので、途中の定義で
     失敗すると、それまでに読めた定義が lookup に残るため (C++ は変えない)。
  返り値は読めたファイルの数。
- 経路は既存の `loadUserStyle` に倣う: `worker/shared/calls/methods.ts` の `MethodMap` 行、
  `WorkerService.ts` の登録、`client/apis/lifecycleApi.ts`、`AsyncCueMol.ts`。
- `renderer/createAndInitCueMol.ts`: `initCueMol` の後、`loadUserStyle` の前に呼ぶ。
  読み込んだ set は先頭に積まれる (push_front) ので、`user_styles.xml` を後から読めば
  user > dotfile になる。
- **要確認**: `user_styles.xml` が無いときは `createStyleSet('user', 0)` が呼ばれ、user set が
  リストの末尾 (push_back、最低優先) に入る (`src/qsys/style/StyleMgrStyleImpl.cpp:214`)。
  この場合 dotfile が GUI 設定を隠してしまう。実装時に lookup 順を確かめ、問題があれば
  worker の fallback で user set を先頭に置く (C++ に front 版の create を足すか、
  `createStyleSet` の後に並べ替える)。scene scope の `createStyleSet` の挙動は変えない。

### 3. rc の実行 (console plugin)
- worker: `plugins/console/worker/runtime/runCommand.ts` の `runScriptPath` を広げる。今は
  qax しか受け付けないが、text script も通す:
  - owner の判定は `scriptOwner(registeredMetas(), path)` のまま。拡張子が `.txt` で owner が
    無いものは native として扱う。
  - qax 以外: ファイルを読み、`dialect.syntax.split(text)` したものを通常の submission と
    同じ経路 (`runInTxn` + `runLines`) で実行する。cwd はファイルのディレクトリ、echo は
    `@<path>`。`runCommand` 本体の text 経路を関数に切り出して共用し、重複させない。
  - 副次効果として、tritium_cli から text script をパスで送ることもできるようになる
    (CLI 側の変更はしない)。
- renderer: `plugins/console/renderer/runSubmission.ts` の継続の送り方を直す。今は scene の操作の後に
  残りを送り直すときも、元の `scriptPath` を毎回付けている。worker は `scriptPath` を `text` より優先
  するので、text script に `create_scene` と後続のコマンドがあると、scene を作るたびにファイルを先頭から
  読み直し、scene を作り続ける。
  - 最初の呼び出しが成功した (ファイルを読み始めた) 後の継続では、`scriptPath` を外し、返された `rest` と
    `cwd` を送る。
  - scene が無いことによる `not-found` の再試行 (まだ何も実行していない) は、今までどおり `scriptPath`
    付きで送り直す。
- renderer: `plugins/console/renderer/useStartupScripts.ts` を新設し、`ConsoleRoot.tsx` で
  mount する (`useConsoleEndpoint` の隣)。
  - `IPC.APP_PATH` の `startupScripts` を取得する。各ファイルについて、拡張子から期待する
    dialect id を `scriptOwner(useDialectMetas(), path)` で解決する (`.txt` は native)。
    解決できなければ skip メッセージを出す。
  - 解決できたものは、**手で打った submission と同じ runner の経路**で 1 ファイルずつ順に実行する
    (`runSubmission` を直接呼んで `consoleSession.append` で足すだけにはしない)。
    `useConsoleRunner` に、script のパスを受けて完了まで待てる実行 (`runScript(path, dialect)`、
    `Promise` を返す) を足し、`run` と同じ仕組みを通す:
    - `consoleSession.begin()` で実行中にする -> Stop が表示され、`useSuppressUndoRedo(running)` で
      実行中の Undo/Redo が抑止される (worker の txn の途中に undo で入らないため)。
    - `runIdRef` に `startup-N` の run id を入れ、`stoppedRef` を `runSubmission` の `stopped` に渡す
      -> Stop で `cancelRun` がその run id に送られ、scene の操作の後の継続も止まる。
    - 終わったら `consoleSession.finish(entries)`。echo と結果の行には `[startup] ` を付ける。
  - cwd: 各ファイルの実行を始めるときに `cwd = dirname(scriptPath)` を明示して `runSubmission` に渡す
    (`.qax` にも)。worker の qax の経路 (`runQaxStandalone`) は `cwd` が渡されないと console の今の
    ディレクトリ (`workDirFor`) を使うので、`startup.qax` の中の相対パスが `~/.cuemol/` から解決されない。
  - Stop の扱い: 実行中の rc を Stop したら、そのファイルを止め、**残りの startup ファイルも実行しない**
    (起動処理全体の中止。transcript に「startup scripts stopped」と出す)。コマンドのエラーで 1 ファイルが
    失敗したときは、今までどおり残りのファイルを実行する (区別する)。
  - gate の release は、最後のファイル (または Stop) の `runSubmission` が戻ってから行う。Stop を
    押しても、worker の実行が止まって戻るまでは gate を開けない。release は Promise の完了に付け、
    `ConsoleRoot` の unmount には付けない (gate は host 側の module の状態なので、Root が消えても残る)。
  - 実行中に Console plugin を off にした場合 (Root の unmount): `useConsoleRunner` の後始末で、実行中の
    run (rc でも手で打ったコマンドでも) に `cancelRun` を送る。今の後始末は `consoleSession.reset()` だけで
    worker の実行を取り消さないので、off にすると Stop の手段が無くなり、再び on にしても新しい runner の
    `runIdRef` は空で止められない。取り消された rc の Promise が戻った時点で gate を開け、残りの startup
    ファイルは Stop と同じく実行しない。
    - 残る制約: `useSuppressUndoRedo` のロックは unmount で外れるので、取り消しが worker に届いて txn が
      閉じるまでの短い間は Undo/Redo が抑止されない。plugin の無効化を実行の終了まで保留すれば避けられるが、
      Settings の plugin の切り替えに手を入れる割に得るものが小さいので、行わない。
  - ファイル名やどの dialect かは純関数 `planStartupScripts(paths, metas)` で決め、ここをテストする。
  - 実行は起動につき 1 回だけ。「実行済み / skip 済み」の状態は `ConsoleRoot` の ref ではなく、plugin の
    mount より長く生きる host 側 (下記の startup gate の module の状態) に置く。`PluginRoots` は plugin を
    off にすると Root を unmount し、on にすると新しく mount するので、ref だと off -> on で rc を
    再実行してしまう。
  - 実行する対象は、保存済みの plugin 設定を読んだ後 (`prefsLoaded`) に決める。初期の既定値だけで
    判断すると、保存では off の dialect を実行してしまう。
- argv で渡されたファイルより先に rc を実行するための順序の gate (`plugin-host/startupGate.ts`):
  - plugin は mount 時に同期的に `holdStartup()` で保留を登録する。`prefsLoaded` と最初の scene の
    settled を待ってから、`claimStartup()` で実行の権利を取る。`claimStartup()` は起動の窓が開いている
    間に 1 回だけ true を返す (2 回目以降と、gate が一度開いた後は false。off -> on の再 mount では
    実行しない)。実行が終わったら release する。
  - `prefsLoaded` の前に既定値で mount され、保存された設定で off になって unmount された plugin は、
    claim していなければ cleanup で保留を外す (gate を止めたままにしない)。
  - `features/file-io/useShellOpenFiles.ts` は drain の前に `await startupSettled()` する。
  - `tritium_cli` のコマンド (`plugins/console/renderer/useConsoleEndpoint.ts` の `run` 要求) も、
    `runSubmission` を呼ぶ前に `await startupSettled()` する。endpoint は `cm` が ready になれば有効になり、
    CLI は接続情報に endpoint が出た時点で起動完了とみなすので、待たないと rc の実行中に利用者の
    コマンドが届き、worker の txn が使用中 (`txnBusy`) で一方が拒否される。`info` などの実行しない応答は
    待たせない。待っている間にクライアントが取り消した要求は、gate が開いても実行しない。
    `startupSettled` は「`prefsLoaded` かつ最初の scene が settled で、保留が 0」で解決する。
  - rc 側の開始条件の「最初の scene が settled」は plugin から見えないので、`useInitialSceneSettled` を
    plugin-host api に公開する (`useAppInitialization` の `initialSceneSettled` を context 経由で出す)。
  - timeout は「保留を登録したまま実行が始まらない」場合だけに付ける (例: 30 s。登録漏れや、
    `prefsLoaded` が来ない場合の保険)。**実行を始めた rc には timeout を付けない**: gate だけを開けても
    実行中の worker の呼び出しと undo txn は止まらず、shell open のファイル読込と rc が同じ scene を
    並行して変えてしまう (既存の shell open のキューはファイル読込どうしを直列にするだけ)。長くかかる
    rc は console の Stop で止められ、止まって `runSubmission` が戻ってから release する。

### 4. ドキュメント
- `docs/architecture/user-dotfiles.md` を新設する (新規機能なので migration ADR ではなく
  architecture 側)。dot dir の構成、実行順、優先順位、CUEMOL_HOME を書き、
  `docs/architecture/_index.md` に 1 行追加する。
- console plugin の settings 説明 (`plugins/console/manifest.ts:30` 付近、local-api.json に
  触れている箇所) に startup script の場所を一文で足す。

## 再利用する既存コード
- `scriptOwner` / `NATIVE_META` — `plugins/console/shared/dialectMeta.ts`
- `runSubmission` — `plugins/console/renderer/runSubmission.ts` (scene が無いときの ensure と再送を含む)
- `useConsoleRunner` の実行・Stop (`runIdRef` / `stoppedRef` / `cancelRun`、`useSuppressUndoRedo`) — `plugins/console/renderer/useConsoleRunner.ts`
- CLI の echo prefix の方式 — `plugins/console/renderer/useConsoleEndpoint.ts`
- `runInTxn` / `runLines` / `runQaxStandalone` — `plugins/console/worker/runtime/runCommand.ts`
- `loadUserStyle` の worker 経路一式 — `renderer/worker/server/workerLifecycle.ts` ほか
- shell open の gate — `renderer/features/file-io/useShellOpenFiles.ts`

## 検証
1. `cd build_scripts && task build_tritium`
2. 起動前に `pgrep -fl "tritium/node_modules/.pnpm/electron"` で残っているプロセスを確認し、
   あれば終了させる。テスト用の dot dir を scratchpad に作り、`CUEMOL_HOME=<dir> task run_tritium`
   で起動する。用意するファイル:
   - `startup.txt`: native コマンドで PDB を load し、何か表示を変える
   - `startup.pml` / `startup.cxc`: 色や表示を変える 1–2 行
   - `styles/my.xml`: `<styles id="mydot">` で既存 style を上書きする定義
   - 確認すること: transcript の `[startup]` 出力、実行順、Cmd+Z で 1 ファイル分ずつ戻ること、
     scene tree の global style に `mydot` (read-only) があること、style の値が効いていること
   - PyMOL plugin を off にすると `.pml` が skip と表示されること
   - `CUEMOL_HOME=<dir> task run_tritium -- <file.pdb>` 相当で、rc の後に argv のファイルが
     開くこと
   - Settings で DefaultLabel を変えて再起動しても、dotfile 側の定義に隠れないこと
     (上記の「要確認」)
   - `styles/` に `id="user"` のファイルを置いても読まれず、終了後の `user_styles.xml` が変わらないこと
   - `startup.txt` に `create_scene` と後続のコマンドを書いても、scene が 1 つだけ作られること
   - Console plugin を off -> on にしても rc が再実行されないこと
   - 時間のかかる rc の実行中に Console plugin を off にすると、rc が取り消され、残りの startup ファイルは
     実行されず、その後に argv のファイルが開くこと (再び on にしても rc は再実行されない)
   - `startup.qax` の中の相対パスが `~/.cuemol/` から解決されること (`startup.txt` が無くても)
   - アプリが起動していない状態で、時間のかかる rc を置いて `tritium_cli -c '...'` を打つと、rc の後に
     そのコマンドが実行されること
   - 時間のかかる rc (`fetch` など) の実行中に Stop が表示され、押すと rc が止まり、残りの startup ファイルは
     実行されず、その後に argv のファイルが開くこと。実行中は Cmd+Z が効かないこと
   - `CUEMOL_HOME=<dir>` で起動したアプリに、同じ `CUEMOL_HOME` の `tritium_cli` が接続できること
3. ユーザーの目視確認 → 挙動が確定してから test / lint:
   - `cd tritium/react-gui && npm test`。新規テストは最小限:
     - `runScriptPath` が text script を owner dialect で 1 txn・cwd = ファイルのディレクトリで
       実行する (worker の契約)
     - `runSubmission`: scene の操作の後の継続では `scriptPath` を外して `rest` を送り、`not-found` の
       再試行では `scriptPath` を付けたまま送る
     - `planStartupScripts`: 固定順、`.txt` = native、plugin off の dialect は skip
     - startup gate: `claimStartup` が起動につき 1 回だけ true (再 mount では false)、claim せずに
       unmount した保留は外れる、実行中の保留は timeout で外れない
     - endpoint の `run` 要求が gate が開くまで実行されず、待っている間に取り消された要求は gate が開いても
       実行されないこと
     - 実行中に `useConsoleRunner` が unmount されると、その run id に `cancelRun` が送られること
     - rc の実行中に Stop を押すと、その `startup-N` の run id に `cancelRun` が送られ、`runSubmission` が
       戻るまで gate が開かず、残りの startup ファイルは実行されない (境界の 1 件)
     - `loadDotStyles`: 途中まで有効な定義を含む壊れたファイルを skip し、その定義が lookup に残らない
       こと、`id="user"` のファイルを読まず、`user_styles.xml` の読込と保存先が変わらないこと
     - CLI の `infoFilePath`: `CUEMOL_HOME` を `CUEMOL_LOCAL_API_INFO` の次、既定より前に見る
   - `npx tsc -p tsconfig.web.json --noEmit`、`npx tsc -p tsconfig.node.json --noEmit`、
     `task lint_tritium_style`

## review で決めたこと

1. dotfile の `id="user"` は読む前に断る (予約名。GUI 設定の読込と保存先を守る)。空の id も断る。
2. text script の継続は、最初の呼び出しが成功した後は `scriptPath` を外して `rest` を送る。rc の中の
   scene 操作は許し、そのときは scene ごとに undo txn が分かれることを仕様に書く。
3. `CUEMOL_HOME` は CLI の接続情報の場所にも効かせる (main と同じ順の規則)。
4. gate の timeout は実行前の保留だけに付け、実行中の rc は timeout で外さない (止めるのは Stop)。
5. 「起動につき 1 回」の状態は host 側に置き、実行対象は `prefsLoaded` の後に決める。
6. style の読込に失敗したら、その読込で増えた set を worker 側で消す (C++ は変えない)。
7. (第 2 回) rc は手で打った submission と同じ runner の経路 (`useConsoleRunner`) で実行し、実行中の表示・
   Stop・Undo/Redo の抑止に乗せる。Stop は起動処理全体の中止 (残りのファイルを実行しない)、コマンドの
   エラーは 1 ファイルだけの失敗 (残りを実行する) として区別する。gate は `runSubmission` が戻ってから開ける。
8. (第 3 回) `tritium_cli` の `run` 要求も gate を待ち、待つ間に取り消された要求は実行しない。全 rc
   (`.qax` も) に `cwd = dirname(path)` を明示して渡す。
9. (第 4 回) 実行中に Console plugin を off にしたら、unmount の後始末で実行中の run に `cancelRun` を送る
   (手で打ったコマンドにも効く)。gate は Promise の完了で開け、Root の unmount には付けない。plugin の
   無効化を保留する案は、Settings に手を入れる割に得るもの (取り消しが届くまでの短い間の Undo/Redo の
   抑止) が小さいので採らない。
