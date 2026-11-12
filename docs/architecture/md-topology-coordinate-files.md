# MD の topology と座標のファイル (libcuemol2 / tritium)

MD のファイルを「topology」と「座標」に分けて扱う規則と、それを実装する reader、qsc の形をまとめる。PyMOL の
「topology を開いて、座標 / trajectory を後から足す」流れに合わせたもので、UXP には無い新規の設計なので migration
ではなくここに置く。drop で付ける操作は [md-trajectory-attach-on-drop.md](md-trajectory-attach-on-drop.md)、
File > Open MD Trajectory... は [md-trajectory-open-dialog.md](md-trajectory-open-dialog.md)。

## 規則

- **topology と座標を別のものとして扱う**。
  - topology だけのファイル (AMBER `prmtop`、CHARMM/NAMD PSF) は、座標の無い分子として開ける (全原子が原点)。
  - 座標だけのファイル (AMBER restart、NAMD `.coor`) は、dcd などと同じく `Trajectory` の block として付ける (1 frame
    の block)。
  - topology と座標の両方を持つファイル (pdb、gro) は、変換のとき `structframe` block で frame 0 になる。
- **`Trajectory` では sub-stream を使わない**。`<object>` と `<trajfile>` は、それぞれ 1 つのファイルを読む。
- **普通の File > Open で topology と座標を一緒に開く (MolCoord) ときは、main が topology、sub-stream `coord` が座標
  (任意)**。AMBER と NAMD で同じ形。1 frame の構造を分子として開く特例。
- sub-stream 方式では組み合わせが reader ごとに固定される (PSF + rst7 や `prmtop` + `.coor` は MolCoord として読めない)
  が、`Trajectory` なら topology に原子数の合う任意の座標の block を付けられるので読める。原子の並びが合っているかは
  使う人の責任 (block の座標はファイルの原子の順に topology の原子へ当てる。dcd などと同じ)。

## reader

| nickname | class | 種類 | 拡張子 | 読むもの |
|---|---|---|---|---|
| `amberprm` | `AmberPrmtopReader` | ObjReader | `*.prmtop;*.parm7;*.top` | topology。sub-stream `coord` = AMBER restart (任意) |
| `psf` | `PsfMolReader` | ObjReader | `*.psf` | topology。sub-stream `coord` = NAMD `.coor` (任意) |
| `amberrst` | `AmberRstTrajReader` | TrajBlockReader | `*.rst7;*.inpcrd;*.restrt` | AMBER ASCII restart の座標 1 frame |
| `namdcoortraj` | `NamdCoorTrajReader` | TrajBlockReader | `*.coor` | NAMD binary `.coor` の座標 1 frame |
| `structframe` | `StructFrameReader` | TrajBlockReader | (拡張子では選ばれない) | 構造ファイル (pdb / gro) の座標 1 frame |

- `psf` と `amberprm` は `coord` が無いと座標の無い分子を作り、二次構造を計算しない (`Trajectory` が frame 0 で計算
  し直す)。`coord` があれば座標を当て、二次構造を計算する。`Trajectory` の topology としても読める。
- 1 frame の block reader は共通の基底 `SingleFrameTrajReader` を持つ。frame は常に `read()` で読み込み (遅延なし)、
  原子数は topology の全原子数と照合する (qsc で block が topology より先に読まれるときは照合を `append` に任せる)。
  `readFileAtomCount` を実装しているので、付け先の一覧の原子数の絞り込みに乗る。frame の間引き (`nevery`) は無い。
- 解析は分子に当てる処理と共有する: AMBER restart は `AmberCrdReader::parse` / `readNatom`、NAMD `.coor` は
  `NamdCoorFormat` (`read` / `readNatom` / `sniff`)。restart の box と速度は block では読まない。
- restart の拡張子は coord ファイルの選択欄と同じ 3 つ。ASCII の restart は中身で判定できないので、紛らわしい `.rst`、
  `.crd` (mdcrd、CHARMM) は入れない。
- `.coor` を読むのは `namdcoortraj` だけ。File > Open で `.coor` を単独で開くと、dcd などと同じ「trajectory のファイル
  なので topology と一緒に開くか、落として付ける」案内になる (`getCompatibleRendererNames` が `TrajBlock` を返す経路)。
- nickname は分子の reader と block の reader が 1 つの表 (`StreamManager`、同じ category) から引くので、全 reader で
  一意にする。block の名前の末尾の `traj` に意味は無い (`structframe` も block)。

### `namdcoor` の廃止

以前の `NAMDCoorReader` (nickname `namdcoor`) は main が `.coor`、sub-stream `topo` が PSF (必須) と、AMBER と向きが
逆だった (中身の無い分子を作らないための形)。topology を開いて dcd を付ける流れと合わないので廃止し、`psf` +
`coord` に置き換えた。

- 使われていなかったので互換は取らない: `srctype="namdcoor"` の古い qsc は読めない。
- UXP GUI の `fopen-namdcooropt-page.xul` などは `namdcoor` を参照したまま (UXP で `.coor` を開けなくなる)。UXP は
  直していない。
- `namdcoortraj` を `namdcoor` にしなかったのは、古い qsc の `srctype="namdcoor"` を block の reader と取り違えない
  ため。
- tritium の File Open Options の NAMD のページ (PSF のパスを指定) は、AMBER のページと同じ「座標のファイル
  (`.coor`、任意)」を指定する PSF のページ (`PsfOptionsPane`) に替えた。PSF の `.coor` は履歴から補わない (空の
  topology だけの読み込みが主な使い方)。op は `load_namd` (`psfFile`) から `load_psf` (`coordFile`、null で原点) に
  替えた。

## qsc の形

```xml
<!-- AMBER: prmtop を開き、rst7 と dcd を付けた (prmtop + rst7 で開いた分子を変換しても同じ) -->
<object type="Trajectory" name="sys" srctype="amberprm" src="sys.prmtop" alt_src="/data/md/sys.prmtop">
  <ropts bondmode="file"/>
  <trajfiles>
    <trajfile srctype="amberrst" src="sys.rst7" alt_src="/data/md/sys.rst7"><ropts/></trajfile>
    <trajfile srctype="dcdtraj" src="prod.dcd" alt_src="/data/md/prod.dcd"><ropts .../></trajfile>
  </trajfiles>
  <renderer .../>
</object>

<!-- NAMD: PSF を開き、.coor と dcd を付けた -->
<object type="Trajectory" name="sys" srctype="psf" src="sys.psf" alt_src="/data/md/sys.psf">
  <trajfiles>
    <trajfile srctype="namdcoortraj" src="sys.coor" alt_src="/data/md/sys.coor"><ropts/></trajfile>
    <trajfile srctype="dcdtraj" src="prod.dcd" alt_src="/data/md/prod.dcd"><ropts .../></trajfile>
  </trajfiles>
  <renderer .../>
</object>

<!-- File > Open で topology + 座標を開いた分子 (1 frame の特例) -->
<object type="MolCoord" name="sys" srctype="psf" src="sys.psf" alt_src="/data/md/sys.psf">
  <ropts>
    <subsrc><coord src="sys.coor" alt_src="/data/md/sys.coor"/></subsrc>
  </ropts>
</object>
```

- frame 0 は「最初に付けた座標の block」。座標の block を付けずに dcd だけを付ければ、dcd の最初の frame から始まる。
- 変換 (drop で付ける) で frame 0 が何になるかは [md-trajectory-attach-on-drop.md](md-trajectory-attach-on-drop.md) の
  通り。

## sub-stream のパスの解決 (qsys)

sub-stream のパスは object の reader option `ropts/subsrc/<key>` に `src` / `alt_src` として入る。主の `src` と同じに
扱う:

- **保存** (`Object::writeTo2`): reader option のコピーを書き出し、コピーの方の `subsrc` を scene からの相対パス
  (`src`) と絶対パス (`alt_src`) にする。メモリ上の reader option は絶対パスのまま (以前は live の node を書き換えて
  いたので、一度保存するとメモリ上のパスが相対になり、変換の XML 往復などの読み直しで作業ディレクトリから開こうとして
  失敗した)。
- **読み込み** (`SceneXMLReader::procDataSrcLoad`): 主のファイルを読む前に、container が `Object` なら
  `Object::resolveSubSrcPaths(basedir)` が各 entry を `LDataSrcContainer::selectSrcAltSrc` で解決し (scene からの
  相対パス、無ければ `alt_src`)、絶対パスを `src` に書き戻して `alt_src` を消す (主の `src` の `updateSrcPath` と同じ)。
  見つからなければ主のファイルと同じく `IOException`。scene の読み込みも `fromXML` (変換・undo) も、`Trajectory` の
  子の `trajfile` もこの経路を通る。以前は `InOutHandler::readFrom2` が相対の `src` をそのまま使い `alt_src` を捨てて
  いたので、作業ディレクトリと違う場所の qsc では sub-stream が開けなかった。
- `Object::getSubSrcPath(key)` (scriptable method): sub-stream の絶対パス (無ければ "")。変換が座標のファイルを知る
  ために使う。
- `StreamManager::toXML2NoSubSrc(obj, type)` (scriptable method): `toXML2` の、object の `ropts/subsrc` を外した版
  (`SceneXMLWriter::toByteArray` の `bDropSubSrc`)。変換で topology を main のファイルだけで読み直すために使う。

## 座標の無い分子を開いたとき (tritium)

- 「座標なし」= 原子が 2 個以上で、`getBoundBoxMin(false)` と `getBoundBoxMax(false)` がどちらも (0,0,0)
  (`worker/server/services/helpers/hasNoCoords.ts`)。reader に依らない判定なので `prmtop` と PSF の両方に効く。1 原子
  が原点にあるのは本当の位置なので数えない。
- `loadObject` は、座標の無い分子なら view を分子に合わせず (renderer の `centerView` を切る)、結果に
  `noCoords: { natoms }` を入れる。最初の renderer は今まで通り作る (frame が入れば、そのまま見える)。
- `OpenObjByPath` (`useSceneCommands.ts`) は、それを見て「N atoms without coordinates」の通知 (toast) を出し、座標か
  trajectory のファイルを落として付ける方法を添える。MD Tools が無効なら、有効にする手順も添える。
- scene tree に「座標なし」の印は付けない (付け先の一覧で分かる)。

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `src/modules/mdtools/PsfMolReader.*` | `psf` (PSF topology、`coord` 任意) |
| `src/modules/mdtools/SingleFrameTrajReader.*` | 1 frame の block reader の基底 |
| `src/modules/mdtools/AmberRstTrajReader.*`, `AmberCrdReader.*` | `amberrst`、restart の解析 |
| `src/modules/mdtools/NamdCoorTrajReader.*`, `NamdCoorFormat.*` | `namdcoortraj`、`.coor` の解析と sniff |
| `src/qsys/Object.*`, `SceneXMLReader.cpp`, `SceneXMLWriter.*`, `StreamManager.*` | sub-stream のパス、`getSubSrcPath`、`toXML2NoSubSrc` |
| `react-gui/src/plugins/mdtools/trajFormats.ts` | 拡張子 -> reader、topology の reader、1 frame の reader、filter と badge |
| `react-gui/src/renderer/worker/server/services/helpers/hasNoCoords.ts`, `file/loadObject.ts` | 座標なしの判定と開くとき |
| `react-gui/src/renderer/dialogs/fopen-opt-dlgs/panes/PsfOptionsPane.tsx` | PSF の File Open Options |

## テスト

- `test_trajio.cpp` `PsfTopologyTakesCoorAndDcdBlocks`: `psf` + `coord` で座標のある分子、`coord` 無しの topology に
  `.coor` の block と dcd を付けて再生できること。
- `test_amber_reader.cpp` `RestartBlocksFollowTopologyOnlyPrmtopAcrossQsc`: 座標の無い `prmtop` の `Trajectory` に
  restart の block を付け、qsc を往復しても frame 0 が restart の座標であること。
- `test_amber_reader.cpp` `CoordSubStreamSurvivesQscAwayFromCwd`: `prmtop` + `coord` の分子を作業ディレクトリと違う
  場所の qsc に保存して読めること、保存後もメモリ上のパスが絶対パスであること、`toXML2NoSubSrc` に `subsrc` が無いこと。
- `test_namdcoor_sniff.cpp`: `namdcoortraj` の中身の判定。
- `loadObjectService.test.ts`: 座標の無い分子で view を合わせず `noCoords` を返すこと (1 原子は数えない)。
- `loadTrajectory.test.ts`: topology の reader を拡張子で選ぶこと、1 frame の block に間引きを掛けないこと。
- `applyReaderOptions.test.ts`: PSF の `.coor` を `coord` の sub-stream にすること。
