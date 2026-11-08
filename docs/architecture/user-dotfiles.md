# ユーザーの dot directory (`~/.cuemol/`): 起動スクリプトと追加 style

起動のたびに同じ設定をするための場所。PyMOL の `~/.pymolrc` に当たる起動スクリプト (rc) と、
手で書いた style を read-only で読む追加の style file を置く。

```
~/.cuemol/                         (CUEMOL_HOME で差し替え可: 開発・テスト用)
  startup.txt    native のコマンド行                 実行順 1
  startup.qax    native の action (1 action = 1 undo)        2
  startup.pml    PyMOL dialect                               3
  startup.cxc    ChimeraX dialect                            4
  styles/*.xml   追加 style (ファイル名順、read-only、global scope)
  local-api.json tritium_cli の接続情報 (local-api-server.md)
```

- 場所の解決は main の `main/dotDir.ts` (`getDotDir` / `listStartupScripts` / `listDotStyleFiles`)。
  renderer は `IPC.APP_PATH` の `dotDir` / `startupScripts` / `dotStyleFiles` で受け取る。
- `CUEMOL_HOME` は rc と style だけでなく `local-api.json` の場所にも効く。main と `tritium_cli`
  (`cli/src/connection.ts` の `infoFilePath`) は同じ規則で場所を決める:
  `CUEMOL_LOCAL_API_INFO` -> `$CUEMOL_HOME/local-api.json` -> `~/.cuemol/local-api.json`。
  片方だけが `CUEMOL_HOME` を見ると、`CUEMOL_HOME` 付きで起動したアプリに CLI がつながらず、
  既定の場所に別のアプリの情報があればそちらにつながってしまう。

## 追加 style (`styles/*.xml`)

- worker の `loadDotStyles(cm, paths)` (`renderer/worker/server/workerLifecycle.ts`) が、
  `initCueMol` の後、`loadUserStyle` の前に読む (`createAndInitCueMol.ts`)。
- lookup は style set の list を先頭から引く (先に見つかったものが勝つ)。ファイルから読んだ set は
  先頭に入る (`StyleFile::loadStyle` の push_front) ので、優先順位は
  `user` (GUI 設定) > dotfile (ファイル名の後ろのものほど上) > `cuemol3` > `system`。
  GUI で変えた値は dotfile に隠れない。逆に、dotfile で決めたい値が `user_styles.xml` にも
  書かれていると dotfile の値は効かない (`user_styles.xml` の DefaultLabel は全プロパティを持つ)。
- `user_styles.xml` が無いときの空の `user` set も先頭に置く。`createStyleSet` は list の末尾に
  足す (push_back) ので、そのままだと dotfile と system の下になり、GUI の設定が効かなくなる。
  worker が `createObj('StyleSet')` で set を作り、`registerStyleSet(set, 0, 0)` で先頭に登録する
  (失敗したときだけ `createStyleSet` に戻る)。
- 読まずに warn して skip するファイル (起動は止めない):
  - root の `<styles id="...">` の id が無いか空。
  - id が `user`。GUI 設定の set の予約名。dotfile が先に `user` を名乗ると、`user_styles.xml` の読込が
    id 重複で失敗し、終了時の保存 (`saveUserStyle` は名前 `user` で set を探す) が dotfile の内容で
    `user_styles.xml` を上書きする。`user_styles.xml` をコピーして編集したファイルでも起こるので、
    読む前に断る。
  - 読込で例外が出たもの (id 重複・不正 XML・途中の定義の誤り)。`StyleFile::loadNodes` は空の set を
    登録してから中身を読むので、途中で失敗すると、それまでに読めた定義が lookup に残る。読む前の
    global set の uid を控え (`getStyleSetsJSON(0)`)、例外のあとで増えた set を `destroyStyleSet` で
    消す。skip したファイルの定義は 1 つも残らない (C++ は変えていない)。

## 起動スクリプト (rc)

console plugin が実行する (native dialect も console plugin の一部なので、console が off なら
実行しない)。

### いつ、何を

- アプリの起動につき 1 回。CueMol の初期化と最初の scene の作成が終わり、保存済みの plugin 設定を
  読んだ後に実行する。対象は起動時の scene。起動後に console や dialect の plugin を off -> on にしても
  再実行しない (起動時の設定を後から上書きしたり、分子を重ねて読んだりしないため)。
- dialect はファイルの拡張子を持つ dialect (`scriptOwner`)。`.txt` はどの dialect も持たないので native の
  コマンド行として読む。plugin が off の dialect のファイルは実行せず、`[startup] startup.cxc skipped
  (the console dialect for .cxc files is off)` と出す。どのファイルをどの dialect で実行するかは
  `planStartupScripts` (`plugins/console/renderer/startupScripts.ts`)。
- 1 ファイル = 1 submission = 1 undo txn (Cmd+Z で 1 ファイル分戻る)。qax は既存の挙動どおり
  1 action ごと。rc の中で scene を変えるコマンド (`create_scene` など) を使うと、手で打った submission と
  同じく scene ごとに別の txn になる。
- 相対パスはそのファイルのフォルダから解決する (cwd = rc のフォルダ。`.qax` も含め、全ファイルで同じ。
  console の今の cwd や、前に実行したファイルの `cd` には依存しない)。
- エラーで 1 ファイルが止まっても、残りのファイルは実行する。Stop は起動処理全体の中止で、残りの
  ファイルも実行しない。

### 実行の経路

- `useStartupScripts` (`plugins/console/renderer/`、`ConsoleRoot` で mount) が順に
  `useConsoleRunner` の `runScript(path, dialect)` を呼ぶ。手で打った submission と同じ runner なので、
  実行中の表示、Stop (`cancelRun` が `startup-N` の run id に届く)、実行中の Undo/Redo の抑止
  (`useSuppressUndoRedo`) がそのまま効く。transcript には echo と結果を `[startup] ` 付きで出す
  (`[startup] @<path>`、`[startup] CueMol> load 1CRN.pdb`)。
- worker は `RunCommandArgs.scriptPath` で受ける。qax 以外 (`.txt` / `.pml` / `.cxc`) は
  `runScriptPath` がファイルを読み、手で打った行と同じ `runText` に渡す (cwd はファイルのフォルダ)。
  tritium_cli からも text script をパスで送れる。
- `runSubmission` は、scene の操作で submission が分かれたとき、2 回目以降の呼び出しから `scriptPath` を
  外して残り (`rest`) を text で送る。worker は `scriptPath` を `text` より優先するので、パスを送り直すと
  ファイルを先頭から読み直し、`create_scene` を繰り返してしまう。

### startup gate

rc は、OS から渡されたファイル (argv / open-file) を開く前、tritium_cli のコマンドを実行する前に
済ませる。そのための順序の gate が `renderer/plugin-host/startupGate.ts` (host 側の module の状態)。

- plugin は mount 時に `holdStartup()` で保留を登録し、`startupReady()` (保存済みの plugin 設定を
  読み、最初の scene が settled。`AppBoot` が `markStartupReady()` する) を待って `claim()` する。
  claim は起動につき 1 回、gate が開く前だけ成功する。状態が Root の外にあるので、`PluginRoots` が
  off -> on で Root を作り直しても再実行しない。
- gate (`startupSettled()`) は、launch が ready で保留が 0 になったら開く。保留は、実行が終わって
  `release()` したとき、または claim せずに unmount したときに外れる。
- 待つ側: `useShellOpenFiles` の drain と、`useConsoleEndpoint` の `run` 要求 (tritium_cli)。CLI は
  接続情報に endpoint が出た時点で起動完了とみなすので、待たないと rc の実行中に利用者のコマンドが届き、
  worker の txn が使用中で一方が拒否される。待つ間にクライアントが取り消した要求は、gate が開いても
  実行しない。tritium_cli がアプリを起動した場合も、rc -> 利用者のコマンドの順になる。
- timeout (`UNCLAIMED_HOLD_MS`、30 s) は claim されない保留だけに付く (plugin が実行を始めなかった
  ときの保険)。実行中の rc には付けない。gate だけを開けても worker の実行と txn は止まらず、
  ファイルの読込と rc が同じ scene を並行して変えてしまう。長い rc は Stop で止める。gate は
  `runScript` が戻ってから開く。
- 実行中に Console plugin を off にすると、`useConsoleRunner` の unmount の後始末が実行中の run
  (rc でも手で打ったコマンドでも) に `cancelRun` を送る。rc は Stop と同じく残りのファイルを実行せず、
  戻った時点で gate を開ける。残る制約: Undo/Redo の抑止は unmount で外れるので、取り消しが worker に
  届いて txn が閉じるまでの短い間は抑止されない (plugin の無効化を実行の終了まで保留すれば避けられるが、
  Settings の切り替えに手を入れる割に得るものが小さいので行わない)。

### 実行中の表示 (status bar)

rc の実行は Console タブの中だけでは見えない (bottom panel が閉じていたり、別のタブが前にあったり
する)。console plugin は status bar に項目を出す (`StartupStatusItem`、状態は `startupActivity.ts` の
module store)。

- 実行中だけ `Startup 1/3` (黄色、回るアイコン)。クリックで popover が開き、ファイルごとの状態
  (Waiting / Running / Done / Failed / Stopped / Skipped / Not run) と Stop ボタン (Console の Stop と同じ
  `stopper`) が出る。
- 全部うまくいけば消える。失敗 (赤) や Stop (灰色) のときは残り、popover を開いて閉じると消える。
- Stop ボタン (Console の toolbar と popover) は枠のある普通のボタンに赤い 🚫 アイコン (`ui.stop`、
  Phosphor の `Prohibit`) を付ける。Clear / Help と同じ flat だと、hover しないとボタンと分からないため。
