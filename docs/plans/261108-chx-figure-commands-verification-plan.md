# ChX console: 図の script の最終画像の比較 (段階 C)

構造生物学の論文の図とプレゼンを作る script (図作りのコーパス) について、作者が図にした状態だけを ChimeraX と
CueMol で撮って並べ、ChX console の見た目の差を洗い出す計画。結果は優先度付きの一覧にまとめ、別に進めている ChX の
実装の作業に渡す。この計画では cuemol2 のコードは変えない。

関連:
- [261107-chx-tutorial-survey-plan.md](261107-chx-tutorial-survey-plan.md): 優先度付きの一覧を集める先。
- [console-chimerax-dialect](../architecture/console-chimerax-dialect.md) §6: ChX が今対応しているコマンド。

---

## 1. 前提 (手元にあるもの)

- **コーパス**: `/Users/user1/proj64/chx-compare/figcorpus/cxc/` (公式以外の図の script 32 本、1193 コマンド)。
  出典は Guillawme/chimerax-viz、cambiotraining Lesson 9、Pereira の cheat sheet、公式の gallery、RBVI
  chimerax-recipes、olibclarke/chimerax-trimmings。
- **コマンドの棚卸し**: `figcorpus/inventory.md` と `figcorpus/findings.md`。
- **テキストの再生**: `tritium_cli --dialect chimerax` で 1 行ずつ流した結果 (`figcorpus/out*/`)。script ごとに
  `OK` / `PARTIAL` / `SKIPPED` / `ERROR` / `FETCH_FAILED` / `EXCLUDED` に分けてある。
- **比較の仕組み**: `/Users/user1/proj64/chx-compare/` (`cm_runner.py` / `cx_runner.py`、job の JSON
  `{"tutorial", "width", "height", "cmds": [...]}`)。今は動かしていない。この段階はこれを再開したときだけ行う。

## 2. 進め方

- 全行は撮らない。各 script の `save` の行、つまり作者が図にした状態だけを、ChimeraX と CueMol で撮って並べる
  (例: 8B0A なら 6 枚)。合計で 30〜40 枚を目安にする。
- 再生で `ERROR` / `SKIPPED` が無い script から始める。前の行の差が持ち越されて、それを切り分ける手間を省くため。
- ChimeraX 側では撮影の前に `wait` を入れる (`cx_runner.py`)。
- 差の分類は次の 5 つ。
  - A: 対応の誤り
  - B: 既定値の差
  - C: 描画方式の違い
  - D: 未対応による持ち越し
  - E: 見かけの差
- 分担: Claude が下見と絞り込みをし、ユーザーが判断する。
- 流す場所は devmacbookair (`~/proj64/cuemol2` を develop に揃えてビルドしたもの)。ローカルでは別の作業が app を
  起動するので使わない (single instance lock で衝突する)。
- 公式 tutorial のうち図に関わるもの (Binding Sites の表面、cryoEM Intro の地図の表示など) は、棚卸しの頻度表に
  出たコマンドを含む行だけを候補に足す。tutorial を 1 本まるごと流すことはしない。

**成果物**: `figcorpus/out/compare/<script>/index.html` と triage の一覧。A と D に分けたものを survey plan の
一覧に足す。

## 3. 対象外

- 動画 (`movie`、`rock`、`roll`、`wait` と frame 付きの動き)。動画の script は、`save` の時点の状態だけを使う。
- 画質と画像の大きさ (`windowsize`、`save` の `supersample` / `pixelSize` / `quality`)。CueMol 3 では rendering
  で指定する。
- 公式 tutorial の全行の画像比較。
- ChX の実装そのものとテストの追加。直す項目は、実装の作業の側で計画を立てる。

## 4. 完了の条件

- コーパスの各 script の `save` の時点について、比較の画像と差の分類 (A〜E) が揃っている。
- A と D が survey plan の一覧に反映されている。
