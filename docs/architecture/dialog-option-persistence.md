# ダイアログ option の記憶 (セッションを跨ぐ既定値)

ダイアログで最後に確定した option (switch、select、数値、選択式) を記憶し、次に開いたとき
(アプリを再起動した後も) その値で始める。UXP GUI は XUL の `persist="checked"` と
`pref.set("cuemol2.ui.histories.<dlg>...")` で同じことをしていた。tritium ではそれに加えて、UXP が
記憶していなかった数値パラメータと map center の扱いも記憶する。

## ヘルパー `createDialogPrefs`

`tritium/react-gui/src/renderer/utils/createDialogPrefs.ts`

```ts
const prefs = createDialogPrefs<MakeMolSurfPrefs>({
    key: 'cuemol2.ui.histories.makesurf',
    defaults: { useSel: false, selStr: '', probeRadius: 1.4, ... },
    fields: { useSel: isBool, selStr: isStr, probeRadius: isNum(0.1, 10), ... },
})
prefs.load()      // the stored record, each field checked
prefs.save(value) // replace the record
prefs.defaults    // for the Defaults button
```

- 読み込みの規則は 1 つだけ: `fields` の各キーについて、保存値が check を通ればその値、通らなければ
  `defaults[k]` を使う。JSON が壊れているか未保存なら全体が `defaults` になる。`fields` に無いキーは
  捨てる。フィールドを足しても移行処理は要らない。
- `fields` は `{ [K in keyof T]-?: Check }` なので、`T` の全フィールド (optional な uid も含む) に check を
  書かないと compile error になる。型パラメータが `T extends object` なのは、index signature の無い
  interface (`MolSuperposeHistory`) を受けるため。
- check は `isBool` / `isStr` / `isOptNum` / `isNum(min, max)` / `isOneOf(values)`。数値の範囲は
  各ダイアログが UI に渡している min / max と同じにする。enum は選択肢の一覧と比べる。`asBackend` の
  ような正規化関数 (不正値を既定値に置き換えて返す) は不正値も通すので check に使わない。
- prefs はダイアログのファイル内に module-level の定数として置く。

## 保存先

localStorage を使い、key は `cuemol2.ui.histories.<dialog>` とする (UXP の pref 名に揃えた)。
renderer type の履歴、PSF / coord の path、選択式の履歴も localStorage にあるので、それに揃えた。
electron-store (`UiState`) は Settings 画面の設定用。dev (vite dev server) と production では
localStorage が別になるが、対処していない。

## 読み込みと保存の時点

- **読み込み**: ダイアログを開くたび。既存の open-reset effect (`useMolEditCommit` の `onReset`
  など) で、ハードコードの初期値の代わりに `prefs.load()` の値を set する。
- **保存**: 記憶対象の state を、その時の値のまま丸ごと `save()` する。Cancel では保存しない。

| 処理の形 | ダイアログ | 保存する時点 |
|---|---|---|
| ダイアログ内で処理し、失敗時は開いたまま | `useMolEditCommit` を使うもの (merge / resindex / chain id / interaction / makesurf / prot2ndry / superpose) | `onSuccess` |
| ダイアログ内の長い job | APBS (`useCalcApbsJob`) | `onComplete` (成功完了)。Start・Stop・失敗では保存しない |
| 閉じてから呼び出し元が処理 | file open / New Renderer / Export PNG | OK 確定時 |

最後の行だけが「成功後」でないのは、呼び出し元が plugin を含めて 5 か所あり、そこに保存処理を
配るのは割に合わないため。読み込みの失敗はファイルやネットワークが原因で option とは関係なく、
renderer type の履歴なども同じく確定時に保存している。UXP の `center` も閉じるときに保存していた。

## 選択式

MolSelList の共有 `selHistory` は候補一覧を出すだけで、入力欄の値は復元しない。そこで選択式を入力する
ダイアログは、前回の選択式を自分の prefs に入れて、開いたときに入力欄へ戻す。

- 「選択範囲を使う」option (makesurf / APBS の `useSel`、prot2ndry の assign mode、interaction の
  2 つ目の Use selection) は、選択式と一緒に記憶する。片方だけを戻すと、空の選択式、つまり全体で
  実行されてしまうため。
- 保存するのはダイアログ state の `selStr` で、worker に渡す payload (makesurf の `effSelStr` のように
  off なら `''` にしたもの) ではない。off のまま実行しても前回の選択式は消えない。
- 開いた時点の分子に対して正しい式かは検査しない。不正な式は実行時の既存のエラー表示になる
  (UXP と同じ)。
- **Delete は記憶しない。** 選択式が入った状態で開くと OK をすぐ押せてしまい、前回の範囲を誤って
  削除しかねないため。

## Defaults ボタン

数値パラメータを記憶すると、既定値を覚えていない限り元に戻せなくなる (APBS の誘電率など)。そこで
数値を記憶する 4 ダイアログ (makesurf / APBS / interaction / prot2ndry) のフッター左側に Defaults が
ある。

- `DialogShell` の `onDefaults` / `defaultsDisabled` で描く。Cancel / OK と同じ Blueprint `Button` に
  するため、汎用のフッター枠ではなくボタンそのものを `DialogShell` が持つ。`submitting` 中は自動で
  無効になる。APBS は計算中 (`running`) も `defaultsDisabled` で無効にする。完了時に最新の render の
  state を保存するので、実行中に戻せると計算に使っていない値が保存されてしまうため。
- 戻すのは**計算パラメータだけ**で、対象 (分子・選択式・use selection・prot2ndry の mode / secType) は
  戻さない。保存は通常どおり確定時なので、Defaults の後に Cancel すれば記憶は変わらない。

## file open と New Renderer

`useRendererOptions` (`dialogs/fopen-opt-dlgs/useRendererOptions.ts`) は `prefsHost: 'fileOpen' |
'newRenderer'` を受け取り、`renderer_options.<host>` に `centerView` と `mapCenterPolicy` を記憶する。
host ごとに分けているのは、UXP の xulstore が host ドキュメント別だったため。`commitHistory()` は
両方を常に保存する。分子のときの `mapCenterPolicy` や map のときの `centerView` のように、画面に
出ていない方は復元した値をそのまま書き戻すだけになる。

ダイアログを出さない open (drop、shell open、console の `open`) には記憶値を使わない。記憶は
ダイアログの初期値だけに効く。

### New Renderer の map center

`createRendererOnObject` は省略可能な引数 `mapCenterPolicy` を持ち、渡されたときだけ `setupRenderer()` の
後 (同じ undo txn 内) で `applyMapCenterPolicy` を呼ぶ。`applyMapCenterPolicy` は DensityMap 以外では
何もしない。

- GUI では `useSceneTreeRendererOps` がダイアログの `rendOpts.mapCenterPolicy` を渡す。
- `create_renderer` op は、引数が省略または null なら何もせず、`'auto'` を含む明示値なら適用する
  (`args.mapCenterPolicy ?? undefined`)。
- `recordCreateRenderer` は policy を実際に適用したときだけ、記録に `mapCenterPolicy` を書く。

**既知の制限: preset には適用しない。** preset の `setupRenderer` が返すのは `RendGroup` で、その
`center` は readonly なので、Set map center が子 renderer に届かない。さらに `create_preset_renderer` の
記録にも policy が無い。組み込みの preset は `MolCoord-rendpreset` だけで、DensityMap の preset は
ユーザーが自作したときにしか現れない。そのため preset のときも select は操作できるが、効果はない。

## 記憶するもの

key は `cuemol2.ui.histories.` の後ろの部分。

| ダイアログ | key | 記憶する state | Defaults で戻すもの |
|---|---|---|---|
| `FileOpenOptionDialog` | `renderer_options.fileOpen` | `centerView`, `mapCenterPolicy` | (ボタン無し) |
| `NewRendererDialog` | `renderer_options.newRenderer` | `centerView`, `mapCenterPolicy` | (ボタン無し) |
| `MergeMolDialog` | `mol_merge` | `copy`, `selStr` | (ボタン無し) |
| `ChangeResidueIndexDialog` | `chg_resindex` | `renumber`, `selStr` | (ボタン無し) |
| `ChangeChainIdDialog` | `chg_chainid` | `selStr` | (ボタン無し) |
| `InteractionAnalysisDialog` | `intr_tool` | `selStr`, `useSel2`, `selStr2`, `minDist`, `maxDist`, `maxLabels`, `hbondOnly` | `minDist`, `maxDist`, `maxLabels`, `hbondOnly` |
| `MakeMolSurfDialog` | `makesurf` | `useSel`, `selStr`, `probeRadius`, `density`, `backend` | `probeRadius`, `density`, `backend` |
| `CalcApbsPotDialog` | `apbs_calcpot` | `useSel`, `selStr`, `chargeMethod`, `useHydrogen`, `useNpbe`, `temperature`, `gridSpacing`, `waterDielec`, `protDielec` | 選択以外のすべて |
| `ReassignProt2ndryDialog` | `prot2ndry_tool` | `mode`, `selStr`, `secType`, `ignBulge`, `helixGapFill`, `helixAngle` | `ignBulge`, `helixGapFill`, `helixAngle` |
| `ExportPngOptionsDialog` | `exportpng_opt` | `dpi`, `unit`, `retainAspect`, `alpha` | (ボタン無し) |
| `MolSuperposeDialog` | `mol_superpose` | `refObjId`, `movObjId`, `refSel`, `movSel`, `algo`, `pivot`, `autoRecenter`, `useprop` | (ボタン無し) |

記憶しないもの:

- Export PNG の幅・高さ (view のサイズから決まる)。
- 名前の入力 (`surfName` / `elepotName` / `rendName`)。毎回一意な名前を提案する挙動を保つため。
- APBS の `forceField`。開くたびに設定の `apbsConfig.pdb2pqrFF` から初期化しており、記憶すると既定値の
  出どころが 2 つになる。Defaults でも触らない。
- 対象の分子の uid (merge / chain id / resindex / delete / interaction)。uid はセッション内でしか意味が
  ない。superpose だけは以前から uid を記憶しており、開いた時点のシーンに残っていれば使う。
- 一覧に無いダイアログ (`QscWriterOptionDialog`、`RegenMolSurfDialog`、`CutSurfByPlaneDialog`、getpdb
  plugin など)。必要になれば同じヘルパーで足せる。plugin から使うなら `plugin-host/api` から出す。
