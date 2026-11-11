# ChX console: `surface` の chain ごとの処理を軽くする

ChX の `surface` は、ChimeraX に合わせて chain ごとに表面の renderer (`dsurface`) を 1 つずつ作る。そのとき、
表面 1 つごとに余計な op と選択式の評価を何度も行っているため、chain の多い構造で極端に遅い。表面を chain ごとに
作ることは変えずに、1 つの表面に必要な処理だけにする。

**範囲**: ChX console plugin の中で完結する (libcuemol2 は変えない)。chain の平均色を求めるのに worker の
service が足りなければ、TS の service として足す。C++ の変更が要ると分かった場合は、GUI や全体でも役に立つかを
確かめてから別に扱う。

関連:
- [261108-chx-figure-commands-verification-plan.md](261108-chx-figure-commands-verification-plan.md): 段階 B で、
  gallery の `card.cxc` (`open 4v6x`、`surf`) がこのために 5 分を超えても終わらなかった。
- [console-chimerax-dialect](../architecture/console-chimerax-dialect.md) §6 (`surface`): 今の仕様。直したら書き換える。
- 実装: `tritium/react-gui/src/plugins/chimerax-console/worker/surface.ts` (`showSurfaces`、`makeSurface`、
  `initialPaint`)、`display.ts` (`readPaint`、`replacePaint`)、`commands/viewCommands.ts` (`inheritSilhouettes`)。

---

## 1. 測ったこと (2026-11-08)

対象は `4v6x` (リボソーム、237,685 原子、89 chain)。

| 何を | 時間 | 備考 |
|---|---|---|
| ChimeraX 1.12 の `surf` (GUI なし) | **9.7 s** | chain ごとに 89 個の SES。一番大きい chain (A5) は 1,120 万三角形 |
| CueMol の native console で `dsurface` を 1 つ (分子全体) | **4.3 s** | ユーザーが手元で計測。distfield、格子は 0.812 Å に粗くして 300 万頂点 |
| ChX の `surface /AA` (小さい chain 1 本) | コマンドの実行 6.0 s | 表面を作る前、op を流すだけで 6 秒 |
| ChX の `surface /A5` (一番大きい chain 1 本) | コマンドの実行 5.3 s | 同上。表面の計算はこの後の描画で行う |
| ChX の `surface #1 enclose #1` (表面 1 つ) | コマンドの実行 2.4 s | |
| ChX の `surface` (89 chain) | **810.7 s (13.5 分)** | CLI は 300 秒で待つのをやめたが、app は処理を続けた。終わるまでの時間を、後から送った軽いコマンドで測った。1 chain あたり約 9 秒 |

- 測定には devmacbookair の app (develop に `fix/chx-batch1` の変更を載せたもの) を使った。スクリプトは
  `/Users/user1/proj64/chx-compare/figcorpus/surfperf/surf_timing.py`。
- この app では、`open` の後に軽いコマンドを送っても、返るまでに 15 秒かかった (237,685 原子の球の表示の描画と見られる)。
  表は「コマンドが返るまで」の時間で、この描画の分は含まない。
- **結論**: 表面の計算 (C++) は分子全体でも 4〜5 秒で、問題ない。遅いのは、ChX が表面 1 つごとに流す処理で、
  1 chain あたり約 5 秒かかっている。chain の数に比例して増える。

## 2. 今の処理 (表面 1 つごと)

`showSurfaces` は、spec が触れる chain ごとに次を行う。

1. `makeSurface`:
   - `create_renderer` (`dsurface`、`sel` は `(chain) and polymer`)。
   - `showsel` を空にする (`set_node_prop`)。
   - `initialPaint`: cartoon または原子の renderer の塗りの表を読む (`list_paint`)。
   - `replacePaint`: 表を表面にコピーする。`ensurePaint` で塗りに切り替え、`clear_paint` で既定の表を消し、
     行ごとに `add_paint_at`。**表は分子全体のもの** (全 chain の行) を、表面ごとにまるごとコピーしている。
   - `inheritSilhouettes`: 輪郭線の設定を写す (`set_node_prop` を最大 3 個)。
2. `writeShowSel`: 今の `showsel` を読み、spec の分を足した式を `simplifySel` (C++ の `SelCommand::simplify`) で
   整えてから書く。
3. ループの前に、`chainsHit` で spec が触れる chain を求める。

各 op は undo と記録 (action log) の処理を通る。選択式を引数に取る op と `simplifySel` は、そのたびに選択式を
組み立てて評価しうる。どれがどれだけ時間を食っているかは、まだ測っていない (§4 の手順 1)。

## 3. ChimeraX が実際にしていること

- 表面の色は、**chain ごとに 1 色**。その chain の ribbon の色の平均 (`molsurf.py` の `surface_initial_color`、
  `atoms.average_ribbon_color`)。残基ごとの色は写さない。
- `surface` は表面を作って全体を見せる。部分だけを見せるのは `surface :10-50` のように spec が chain の一部の
  ときだけ。
- 今の ChX は、ソースのコメントのとおり「残基ごとの色を保つ」ために表をまるごとコピーしている。これは
  ChimeraX より凝った動作で、要らない。

## 4. 直し方

1. **内訳を測る** (直す前に、どこを削ると効くかを確かめる):
   - ChX の `surface /AA` の 1 回で、各 op と helper (`chainsHit`、`simplifySel`、`list_paint`、`add_paint_at`、
     `create_renderer`、`set_node_prop`) にかかった時間と回数を出す。
   - 開発用のビルドで一時的に計時のログを入れて測り、コミットはしない。
   - 結果をこのプランに書き足す。
2. **色は chain ごとに 1 色にする**:
   - 新しい表面の塗りの表は、`*` に 1 色を塗る 1 行だけにする。色は、cartoon (無ければ原子の renderer) で
     その chain の原子に付いている色の平均 (ChimeraX と同じ)。
   - 色を求めるのは、chain ごとの代表原子 (残基の CA / P) の色を、その renderer の coloring で引く処理。worker
     から C++ の coloring を呼ぶ既存の手段を使う (`getColor` 相当)。無ければ、chain ごとの平均色を返す小さな
     service を足す。
   - 塗りに切り替えたときに入る既定の表を消して 1 行を足すのに、op が 3 個要る (`ensurePaint`、`clear_paint`、
     `add_paint_at`)。これを 1 回で済ませる手段 (塗りの表を丸ごと置き換える op) があればそれを使う。無ければ、
     この 3 個で済ませる (表をまるごとコピーするより桁で少ない)。
3. **作った直後の `showsel` の空書きをやめる**:
   - spec が chain 全体を指すとき (`surface`、`surface /A`) は、`showsel` を既定 (全部表示) のままにする。
   - 一部を指すとき (`surface :10-50`) だけ、その部分を書く。
   - 既にある表面に足すとき (`writeShowSel` の和) は今のまま。
4. **輪郭線**: 全体の設定 (`graphics silhouettes`) が有効なときだけ書く。今もその条件だが、表面ごとに
   `outlinedRenderers` で全 renderer を読み直しているので、ループの前に 1 回だけ読む。
5. **ループの外に出せるもの**: `surfacesOn` (既存の表面の一覧)、輪郭線の基準 (手順 4)、色の元にする renderer の
   特定は、chain ごとではなく 1 回だけ行う。
6. 手順 1 の結果で、`simplifySel` や選択式の評価が支配的と分かった場合は、chain 全体を指す場合に式の整形を
   飛ばす (`(chain) and polymer` は整形しなくても正しい) などの対策を足す。

**目標**: `4v6x` の `surface` で、ChX のコマンドが返るまで 10 秒以内。その後の表面の計算は合計で数秒〜十数秒
(chain ごとの表面の和) で、ChimeraX の 9.7 秒と同じ桁にする。

## 5. ChimeraX との違いとして受け入れること

- 色は chain ごとの平均の 1 色になる。今の ChX (残基ごとの色を写す) からの変更で、ChimeraX と同じになる。
  `color bychain` の後なら見た目は変わらない。`rainbow` (残基ごと) の後に `surface` を作った場合、今は残基ごとに
  色が付くが、直した後は平均の 1 色になる (ChimeraX と同じ)。
- 表面の色を原子に合わせたいときは、ChimeraX と同じく `color ... fromatoms` などで後から塗る。これは今の
  `color` の実装のまま。

## 6. テスト (最小)

- 1 件: ChX の `surface` (chain が 2 本の分子) で、chain ごとに `dsurface` が 1 つずつでき、それぞれの塗りの表が
  1 行 (chain の色) であること、作った直後の `showsel` が既定のままであること。op の列 (種類と回数) を確かめ、
  表のコピーに戻ったら検知できるようにする。
- 既存の `surface` 系のテストのうち、表のコピーを前提にした期待値は直す。
- 速さはテストにしない (計測はこのプランの §1 の方法で手で行う)。

## 7. 検証

- `4v6x` で §1 と同じ測定をして、ChX の `surface` が目標の時間に入ること。
- quickstart と図のコーパスで `surface` を使う script (cheat sheet Ex 1、4J26、8B0A など) の `save` の画像が、
  色の変更 (§5) 以外は今と同じであること。
- gallery の `card.cxc` の除外 (段階 B の job) を外して、最後まで流れること。
