# Styles view (Style Sets / Colors / Selections pane)

Status: Accepted (2026-11)

## 背景と目的

UXP GUI では style set は workspace tree の最後の枝 (`Styles`) にぶら下がり、操作 (New / Load /
Reload / Edit... / Read only の切り替え / Save / Save as / Copy) はすべて右クリックメニューにあった。
色の定義と selection の定義を編集するには、Edit... で Style Editor ダイアログを開き、Color /
Selection / Styles のタブを切り替える必要があった。tritium も当初はこの構成を移植していた
(ADR-0006 / ADR-0028)。

名前付きの色と selection は、カラーピッカーの Named 一覧や Selection pane からも使える。ただ、
定義を見ながら編集するには専用の pane のほうが扱いやすい。そこで style set を scene tree から外し、
activity bar の新しい **Styles** view に、style set の一覧と、その set の色・selection を編集する
pane を並べた。camera を tree から外したとき ([camera-pane](camera-pane.md)) と同じやり方
(tree のノードを消し、pane 固有の ctx action 写像を持つ)。

## 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 配置 | activity bar の Explorer の直後に **Styles** view (アイコン `activity.styles` = Phosphor `Swatches`)。pane は上から Style Sets / Colors / Selections | 中身が全部 style set の内容なので、そのまま名前にした。Actions view の Library pane とも紛れない |
| scene tree の Styles 枝 | **撤去**。`SceneNodeType` の `styleRoot` / `style`、`styleInfo`、`buildStyleRoot` を削除 | 表示と操作の入口が 2 箇所にあると drift する。camera と同じ判断 |
| Colors / Selections が表示するもの | Style Sets pane で**選んだ 1 つの set** の中身 | 書き込み先が 1 つに決まる。全 set を合わせた一覧にすると、同名の定義がどの set のものか、どこに書くかが曖昧になる |
| 一覧の並び | **scene local の set を先に、global の set を後に**。それぞれの scope の中は C++ のリスト順 | 名前を探す順番 (優先順位の高い順) と一致させる。下の「並び順」を参照。UXP は global を先に出していたので、優先度の高い set が下にあった |
| 編集できるかどうか | set の **read only フラグだけ**で決める (worker でも拒否する) | global かどうかでは決められない。下の「編集できる set」を参照 |
| Style Editor ダイアログ | **style entry の一覧 (削除のみ) だけを残す**。タイトルは `Style entries: <set>`、右クリックの項目名も "Style Entries..." | 色と selection は pane で編集できるので、同じ UI を 2 つ持たない。style entry は pane に入れていない |
| selection の値の編集 | Selections pane の行は `MolSelList` (Colors pane の `ColorField` と同じく、カラーピッカー相当の builder 付き) | 自由入力より、Named / History / builder が使える方が書きやすい |

## 並び順

`StyleMgr` は名前 (色、style、selection) を、まず scene の StyleList から、次に global
(scope 0 = `qlib::invalid_uid`) の StyleList から、それぞれ**先頭から**探す。ファイルから読んだ set は
リストの先頭に入る (`push_front`)。`listStyleSets` はこの順番どおりに、`getStyleSetsJSON(sceneId)` の
結果の後ろに `getStyleSetsJSON(0)` の結果をつなぐ。`getStyleSetsJSON` は 1 つの scope の set しか
返さない点に注意 (global の set を探すときは scope 0 も見る必要がある)。

## 編集できる set

| set | 読み込み | read only | 終了時の保存 |
|---|---|---|---|
| scene の set (`default` など) | scene と一緒 | set ごとに切り替え可 | scene と一緒に保存 |
| `user` (global) | `user_styles.xml` (無ければ空の set を作る) | なし | **保存される** (`saveUserStyle`) |
| dot ディレクトリ (`~/.cuemol/styles/*.xml`, global) | `loadDotStyles` | あり | されない (手で書いたファイルを勝手に書き換えない) |
| 同梱の set (`system`, `cuemol3` など, global) | C++ の初期化 (`qsys::loadStyle`、sysconfig の `style_file`) | **起動時に付ける** | されない |

同梱の set は C++ が read only を付けずに読み込む。そのままだと編集できてしまうが、保存されないので
次の起動で消え、Save をするとアプリ本体の中のファイルを書き換えてしまう。そこで worker の
`initCueMol` の直後、dot と user の style を読む前に、その時点にある global の set を read only にする
(`workerLifecycle.markBundledStylesReadOnly`)。これで「read only でない = 編集してよい」が成り立ち、
`user` は編集でき、同梱と dot の set は表示のみになる。renderer から style を作るダイアログの保存先も
read only の set を除くので、同梱の set (`cuemol3` など) は出なくなった。

set 単位の操作 (削除 / コピー / ファイルに保存 / read only の切り替え) は、今までどおり global の set
では使えない。global の set は scene の持ち物ではないため (UXP `onStyCtxtShowing` と同じ)。

## undo

- scene の set への編集は、1 回ごとに scene の undo txn を張る (1 undo step)。
- global の set (`user`) への編集は **undo できない**。C++ の `StyleSet` は自分の scene id (global は
  invalid) の UndoManager に記録するので、global の set には記録先が無い。scene に属さないものを
  scene の undo で戻せる方がおかしいので、これで正しい。worker はこのとき scene の txn を張らない
  (空の txn を commit すると、Redo の履歴が消えるため)。

## 書き込みは StyleManager を通す

色と selection の書き込みは `StyleSet.setColor` などではなく、`StyleManager.setColor(key, col,
scopeId, styleSetId)` / `removeColor` / `setStrData` / `removeStrData` を呼ぶ。`StyleSet` の
`*Scr` メソッドは pending event を積まない (C++ に "TO DO" のまま) ので、そちらを使うと
`firePendingEvents` を呼んでも NamedColor のキャッシュが無効にならず、その色を使っている ribbon などが
描き直されない。`StyleMgr` 側は `*Scr` を呼んだうえで event を積むので、`fireEventImpl` ->
`Renderer::styleChanged` (`DispCacheRenderer` が display cache を捨てる) まで届く。

## worker services

| service | 役割 |
|---|---|
| `listStyleSets({ sceneId })` (`services/style/styleSetList.ts`) | 上の順番で `StyleSetEntry[]` (`uid, name, scopeId, src, readonly, modified`、`worker/shared/styleSetTypes.ts`) を返す |
| `getStyleSetContents({ styleSetId })` | set 1 つの色 (hex)、selection (`sel` カテゴリの str-data)、style entry |
| `setStyleSetColor` / `removeStyleSetColor` / `setStyleSetSelection` / `removeStyleSetSelection` / `removeStyleSetStyle` (`services/style/styleSetEdit.ts`) | 共通の `mutate` が set の scope を引き (scene と global の両方の一覧から)、read only なら拒否し、scope に応じて txn を張って書き、`firePendingEvents` を呼ぶ |

set の作成・削除・読み込み・保存・read only の切り替え・コピー & ペーストは、既存の service
(`styleOps.ts` / `styleFile.ts` / clipboard) をそのまま使う。`getSceneTree` は style を返さなくなり、
`deleteNode` から style の分岐を外した。

## renderer 側

`renderer/features/styles/`:

| ファイル | 役割 |
|---|---|
| `StyleSetsPane.tsx` | set の一覧。ツールバーは New / Load / Style entries / Delete。行に `global` タグ、read only の鍵、ファイル由来のリンク。double-click で Style entries ダイアログ。クリップボードの scope は `style-list` |
| `StyleDefsPane.tsx` | Colors と Selections が共有する枠。ヘッダに Add (名前を入力) と Delete、対象の set 名 (read only なら "(read-only)")。行は名前と値の editor |
| `StyleColorsPane.tsx` / `StyleSelectionsPane.tsx` | 行の editor が `ColorField` / `SelValueField` (`MolSelList`)。新規の値は `#ffffff` / `*` |
| `useStyleSets.ts` | `useLiveFetch(listStyleSets)` と `useStyleSetContents`、どちらも `SEM_STYLE` で取り直す。選んだ set は module 単位の external store (`useSyncExternalStore`) に持ち、3 つの pane で共有する。選んだ set が無くなったら、書き込める scene の set、scene の set、一覧の先頭の順で選び直す |
| `styleOps.ts` | pane が呼ぶ service の薄い wrapper |
| `useStyleCommands.ts` | style の command (New / Edit / Delete / Copy / Paste / Read only / Load / Reload / Save / Save as) を app 全体で登録する (`hooks/useCommandRegistrations.ts`)。scene tree の provider から移した |
| `styleCtxActionToCommand.ts` / `useStyleCtxMenu.ts` | 右クリックは共有の style メニュー template (`buildStyleNodeMenu` / `buildStyleRootMenu`) をそのまま使い、action を set に対して command へ写す。`sceneCtxActionToCommand` の style の case は null を返す (網羅性のためだけに残す) |

`shell/SidePanel.tsx` の `VIEW_PANES` に `styles` (sets 200 / colors 260 / selections 260)、
`shell/ActivityBar.tsx` に Explorer の直後として 1 項目。アイコンのキーは `activity.styles`、
`ui.edit`、`ui.namedColor`、`ui.namedSel`。

## テスト

- `__test__/styleSetListService.test.ts`: scene の set が global の set より先に来ること、各フィールド。
- `__test__/styleSetEditService.test.ts`: 書き込みが StyleManager のメソッドを scope 付きで呼び event を
  出すこと (描き直しの不具合の再発防止)、read only の set を拒否すること、global の set には scene の
  txn を張らないこと。
- `__test__/saveUserStyleService.test.ts`: `markBundledStylesReadOnly` が初期化時の global の set を
  read only にすること。
- `features/styles/styleCtxActionToCommand.test.ts`: 右クリックの action の写像。
- pane の見た目は目視で確定したのでテストしない。
