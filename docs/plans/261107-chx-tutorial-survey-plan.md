# ChX console: ChimeraX の tutorial に基づく調査と、後で検討するもの

ChimeraX の公式 tutorial で実際に打たれているコマンドを集め、ChX console に流して、何が通り、何が足りないかを
調べた記録。足りないもののうち、既存のコマンドの書き方の対応 (提案 A) は実装済み (仕様は
[console-chimerax-dialect](../architecture/console-chimerax-dialect.md))。ここに残すのはそれ以外 (新しいコマンド、
CueMol 側の機能追加が要るもの、断るもの、共通の対策) で、別途検討する。

関連: [261103-chimerax-console-plan.md](261103-chimerax-console-plan.md) (lighting・windowsize・clip など、CueMol 側の
機能追加が先に要るものを既に挙げている)。

---

## 1. 調べ方 (2026-11-07)

- **資料**: 公式の tutorial 一覧 (https://www.rbvi.ucsf.edu/chimerax/tutorials.html) から、コマンド操作が中心の
  16 本 (構造の基本、結合部位、AlphaFold、cryo-EM、重ね合わせ、表面と色、図・動画、配列)。DICOM・VR・Chimera (旧版)
  のページは除いた。ChimeraX のソースにある `docs/user/tutorials/binding-sites.html` も加えた。
- **コマンドの取り出し**: tutorial の HTML の `href="cxcmd:..."` のリンクを順に取る (ChimeraX の docs はコマンドを
  このリンクで埋め込む)。リンクの無いページは表の中の文字から取った。
- **検証**: tutorial ごとに新しい scene を作り、コマンドを順に `tritium_cli --dialect chimerax` で流して、出力から
  「動いた / 知らないコマンド / エラー / 一部を無視 / 断った」に分けた。手元のファイルが前提の行 (`~/...`、
  `cd browse` など) は除いた。
- 結果 (845 行、PR #733 の修正後): 動いた 410、知らないコマンド 257、エラー 112、一部を無視・断った 44、除外 22。
  提案 A の実装後: 動いた 453、知らないコマンド 250、エラー 54、一部を無視・断った 66、除外 22。
  エラーには、前の行の失敗に引きずられたもの (`open 7kkj 7kkl` が通らず次の `matchmaker` が失敗) を含む。
- 再現するには、上の一覧から同じ tutorial を取り、同じ形で流す。集めたコマンドと再生の script は作業用の場所に
  あり、リポジトリには入れていない。

### よく使われるのに ChX に無いコマンド (使われた tutorial の本数 / 行数)

`volume` 10 / 49 (`vol` を含む)、`lighting` 9 / 22、`hbonds` 7 / 11、`morph` 7 / 9、`fitmap` (`fit`) 8 / 9、
`preset` 6 / 17、`mlp` 6 / 9、`clip` 5 / 11、`alphafold` 5 / 8 (`fetch` は対応済み)、`movie` 4 / 8、
`coulombic` 4 / 8、`ui` 4 / 9、`mousemode` 4 / 8、`sequence` (`seq`) 6 / 8、`coordset` 3 / 5、`size` 3 / 3 (`stickRadius` は対応済み)、
`log` 3 / 3、`2dlabels` / `key` 3 / 6、`sym` 2、`measure` 2、`swapaa` 2、`windowsize` 2、`camera` 2、`interfaces` 2、
`mseries` 2、`blast` 2、ほか 1 本だけのもの多数。

## 2. 新しいコマンドのうち、CueMol の既存の機能で一部は作れるもの

`volume` (表示の設定と zone)、`lighting` (AO による近似)、`preset`、`camera ortho`、`unitcell outline`、`ribbon`、
`open ... from rcsb_bio / pdbe_bio` は実装済み (提案 B。仕様は
[console-chimerax-dialect](../architecture/console-chimerax-dialect.md) §6)。再生の結果は、動いた 509、知らないコマンド
158、エラー 64、一部を無視・断った 92。

残りは、既存の機能で一部は作れるが、近似で ChimeraX と違う結果になるか、合わせる設計が要るもの。扱いを決めてから
別に行う。

| コマンド | 行数 | 使える CueMol の機能 | 決めること |
|---|---|---|---|
| `hbonds` (`reveal`、`restrict`、`~hbonds`) | 12 | `analyze_interactions` | CueMol は極性原子の間の距離だけで接触を拾う (角度の判定が無い)。ChimeraX は距離と角度 (`distSlop`、`angleSlop`) で判定するので、拾う対が違う |
| `coulombic` | 8 | `calc_elepot` と表面の静電ポテンシャルの色付け | CueMol は APBS (ポアソン・ボルツマン、APBS が要る)、ChimeraX は Coulomb の和 (距離依存の誘電率)。値も見た目も違う |
| `morph #1,2` | 9 | MorphMol (`add_morph_frame`) | ChimeraX の trajectory と再生 (`coordset`) の仕組みと、CueMol の Animation を合わせる設計 |
| `sym #1 assembly n` | 3 | (無い) | mmCIF の会合体の情報が要る。CueMol の `show_symmetry` は結晶の対称で意味が違う |
| `unitcell` (分子のコピーを model として作る部分) | 1 | `create_symmetry_copy` | 表示だけは実装済み (symm renderer)。後のコマンドが名指せる model のコピーと番号の管理は `sym` と一緒に検討 |
| `clashes` / `contacts` / `interfaces` | 6 | (一部 `analyze_interactions`) | 判定の基準が CueMol に無い |

## 3. CueMol 側の機能追加が必要なもの

| コマンド | 使用 | 足りないもの |
|---|---|---|
| `clip near/far/position/off` | 5 本 | CueMol の slab は中心に対称な 1 つだけ (261103 の plan にも記載) |
| `mlp` (疎水性で表面を塗る) | 6 本 | 親油性ポテンシャル (MLP) の計算 |
| `fitmap` / `fit` | 8 本 | 地図とモデルの当てはめ |
| `movie record/encode` と `wait` | 4 本 | コマンドの実行を録画する仕組み (CueMol の動画は Animation から作る) |
| `2dlabels` / `key` | 3 本 | 画面上の 2D の文字と色の凡例 |
| `coordset` / `mseries` | 3 本 | 複数モデル (NMR、morph) を順に表示する仕組み |
| `open ... from pdb_nmr` | 1 本 | NMR-STAR の拘束の reader (今は理由を言って断る) |

## 4. 断る対象 (実用性が低いか、CueMol の設計と合わない)

- **GUI・セッションの操作**: `ui`、`mousemode`、`ks`、`log`、`windowsize`、`tile`、`cd`、`camera 360tb`、
  `scene save`、`.cxs` の保存。console から操作する意味が薄く、CueMol では GUI で行う。
- **配列・外部データベースの解析**: `color byattr seq_conservation`、`sequence associate`、`blast`、
  `alphafold match` / `pae`、`mutationscores`、`alpha_missense`。ChimeraX の配列ビューアや外部サービスが前提。
- **model を組み替える**: `mcopy`、`split`、`combine`、`changechains`。(`turn/move ... models`、`view matrix models` は
  断る対象ではない: §7)
- **構造の編集・モデリング**: `swapaa`、`addh`、`dockprep`、`resfit`、`molmap`、`clashes`、`contacts` (後の 2 つは
  `analyze_interactions` で一部できるかもしれないので、`hbonds` を作るときに再検討)。
- **既に方針として断っているもの**: `name frozen`、sub-model (`#1.1`)、`#!`、`cofr <spec>`。

## 5. 共通の対策: dialect から op への省略可の引数

PR #733 で直した `view` の不具合は、「dialect が op の引数を 1 つ渡し忘れると `null` ではなく `undefined` で op に
届き、`!== null` の判定で「指定あり」と読まれる」ことが原因だった (`set_view` に `rotation` が足されたときに
ChX の `view` だけが渡していなかった)。op に引数が足されるたびに、ChX と PyM console の両方で同じ種類の不具合が
起こりうる。

- 対策: dialect から op を呼ぶ共通の入口 (`plugins/console/worker/runtime/opContext.ts` の `runOp`) で、渡されて
  いない省略可の引数を `null` で補う (MCP や native console は引数を検証して埋めているので、dialect だけの問題)。
- 試した結果: 既存のテスト 27 件が、op に渡る引数を完全一致で確かめているため期待値が変わる (補った `null` が
  入る)。記録される引数にも `null` が入る。期待値の修正は機械的だが、記録の形が変わることの影響 (qax の見た目、
  再生) を確かめてから入れる。

## 6. ChimeraX との画像比較で残った不一致 (2026-11-08)

### 比較の方法

- ChimeraX 1.12 と CueMol の ChX console で、quickstart tutorial のコマンドを `;` で分けて 1 行ずつ流し、各行の後に
  800x600 で撮って左右に並べた。ChimeraX は macOS では offscreen で描けないので、ログイン中の GUI session で窓を出し、
  Python の runner で `chimerax.core.commands.run` を 1 行ずつ try/except で呼ぶ (`.cxc` だと最初のエラーで止まる)。
  CueMol は scene を作った直後に AO を Scene inspector の Medium にしてから流す。
- 比較用の script はリポジトリの外に置く (将来、別のリポジトリにする)。
- エラーにならないのに絵が違ったもののうち、open 後の視点、surface の色と `color fromatoms`、EDS の地図、未対応で
  止めずに続けること、silhouettes の線の種類、地図の fit、後から作る renderer の輪郭線、EDS の地図の名前、名前で
  object を引くときの型は直した (仕様は [console-chimerax-dialect](../architecture/console-chimerax-dialect.md)、
  [view-fit](../architecture/view-fit.md)、[cryo-em-map-mode](../architecture/cryo-em-map-mode.md))。

### 残ったもの

| 項目 | quickstart の行 | 内容 | 扱い |
|---|---|---|---|
| fit の余白 | 0 (2bbv)、27 (EMD-1080) | CueMol は箱の各辺 20% の余白で、対象が画面の約 7 割。ChimeraX は約 9 割 | ChX の最初の open だけ ChimeraX の計算 (視錐台に箱の角を収め、窓の 5%) に合わせるかは未決 |
| open 時の lighting | 0 | ChimeraX は自動 style に応じて `lighting full` / `soft` (AO と影) に切り替える | AO は CueMol 本体で新規 scene の既定を on にする方向で別に検討。ChX では切り替えない |
| `sym` (会合体) | 14、17 以降 | ChimeraX は会合体 3 (ウイルスの殻) を複製として描く。CueMol は非対称単位のまま | [261108-assembly-symmetry-plan](261108-assembly-symmetry-plan.md) |
| `fitmap` | 35、36 | ChimeraX は 1grl を地図の中に動かす (不透明な面に隠れ、36 で半透明にすると透けて見える)。CueMol の地図も 36 で半透明になるが、中が空なので透けて見える物が無い | [261108-em-map-features-plan](261108-em-map-features-plan.md) の関連項目 |
| `molmap`、`vol subtract` | 37〜42 | ChimeraX は模擬 map と差分 map を作り、差分 map (水色、のちピンク) を表示する。CueMol は元の地図のまま。38・40 行は存在しない map を指すので止まる (参照の誤り) | [261108-em-map-features-plan](261108-em-map-features-plan.md) |
| `encloseVolume` | 30 | 色と step は効くが、閾値は ChimeraX と違う | [261108-em-map-features-plan](261108-em-map-features-plan.md) |
| 大きな断層像の地図 | 54、55 | ChimeraX は断面の画像で出す。CueMol は何も写らない | 画像 (image) 表示が無いための機能差 |
| 2 つ目の地図の open | (quickstart には無い) | EMDB / URL の地図は op 側が毎回地図に合わせるので、ChimeraX と違って視点が動く | GUI と共通の op なので変えていない |

## 7. 作れるが未実装のもの (2026-11-08 の点検)

ChX が「CueMol に無い」として断っていた箇所を、renderer の property (.qif)・style・既存の op と突き合わせて点検した
(誤判定だった核酸の板、円柱の helix、`ringFill`、`sdLevel` / `rmsLevel`、`capFaces`、`distance` の色・太さ、
`save displayedOnly` / `.stl`、`unitcell` の表示、`fromcartoons`、`depthCue` の文言は直した。
[console-chimerax-dialect](../architecture/console-chimerax-dialect.md) §6 の冒頭の原則も参照)。残りで、既存の機能で
作れるが規模のあるもの:

| 項目 | 使える CueMol の機能 | 要る作業 |
|---|---|---|
| `size <分子の一部> stickRadius` | ballstick の `bondw` | `bondw` は renderer に 1 つ。一部だけ変えるには stick の renderer を分ける (`display.ts` の renderer の分け方の拡張) |
| `surface dust`、`surface zone ... maxComponents` | `DistFieldSurfBuilder` の連結成分の列挙 | 今の `pruneComponents` は原子の表面からの距離で成分を残す (SES の外側の殻を除く処理) で、大きさで消す機能ではない。大きさの metric (ChimeraX の既定 `size` は bounding box の最大の辺) の集計と、原子を持たない map の表面への適用を C++ で足す |
| 選択の強調表示が隠した原子も描く | `SelectionRenderer` | 分子の選択をすべて描く (`SelectionRenderer.cpp`)。表示中の原子だけを描く option を足す C++ の変更。GUI の挙動も変わるので判断が要る |
| `view matrix models`、`turn` / `move ... models` / `atoms` | object の `xformMat`、`MolCoord.xformByMat` | fit や superpose (`keepAsProperty`) との兼ね合いの設計 |
| `clip` | View の `slab` | slab は中心に対称な 1 つだけ (§3) |
| `contacts` | `calcAtomContact*JSON` | [261108-hbonds-geometric-detection-plan](261108-hbonds-geometric-detection-plan.md) と一緒に |
| `coulombic` | dsurface の `colormode potential` | ChimeraX の部分電荷からの Coulomb の和 (距離依存の誘電率) を計算する部分。APBS の `calc_elepot` は別の計算 (§2) |
| `label height` の zoom への追従 | ラベルの `font_size` | 今は今の zoom での換算。zoom や viewport の変化に合わせて直すか、Å で描くラベルが要る |
| `log clear` | console の `clear()` | dialect から呼ぶ hook |
| `volume style image` | `GLSLMapVolRenderer` | 近似の設計 |
| `cartoon style` の arrows / sides / worm、`cartoon suppressBackboneDisplay`、`label offset` | renderer の property | 対応づけの設計 |

`camera` の stereo の各方式と `eyeSeparation`、配列ごとのランダムな色 (`bypolymer` / `byidentity`、medium / large
polymer の open 時の色) は対応しない (ユーザー判断)。

図の script の段階 B (r2) で残ったもののうち、plugin の外の変更が要るもの (ChX は「not supported yet」のまま):

| 項目 | 要るもの |
|---|---|
| `clip` | 中心に対称でない near / far の面 (§3 と同じ) |
| `2dlabels` / `key` | 画面に固定した文字・凡例の renderer (§8) |
| `size ... atomRadius` | 原子ごとの半径 (§8) |
| `surface dust`、`surface zone ... maxComponents` | `261108-map-surface-dust-plan.md` |
| `label ... bgColor`、`lighting depthCueStart/End`、`set silhouetteDepthJump` | ラベルの背景、slab と別の fog の範囲、輪郭線の深さの閾値 |
| `::area` | 残基の溶媒露出面積の属性 |
| `color zone` の `distance` | 最も近い原子の探索の距離の上限 (`MapSurfRenderer::getColorMol`) |
| `transparency` / `cartoon style modeHelix` を分子の一部に | renderer を分ける `display.ts` の設計の拡張 (原則 4) |

`windowsize` は対応しない (ユーザー判断。画像は `save` の `width` / `height` で決まる)。`preset pub` は ChimeraX 1.12
でも 2 つに当たって error になる (script 側の問題)。

## 8. 既存の API に無いもの (同じ点検で探して無かったもの)

作れないという判断ではなく、今の .qif・op に相当するものが無いという意味。

- `volume gaussian` など地図の filter: `src/modules/xtal` の .qif / .hpp に gauss / smooth / filter が無い。
- `fitmap`: 地図とモデルの当てはめ (ssm / mmdb の superpose だけ)。
- `mlp`: 親油性ポテンシャルの計算が無い。
- `2dlabels` / `key`: 画面に固定した文字・色の凡例の renderer が無い (ラベルは原子に付く 3D のものだけ)。
- 配列ビューア、`lighting` の光の向きと強さ (Umbreon の書き出しにだけある)、原子ごとの半径 (CPK は元素ごとの `vdwr_*`)。
