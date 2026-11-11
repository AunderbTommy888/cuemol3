# 地図の等値面の小さな破片を隠す (ChimeraX の `surface dust`)

電顕の地図を等値面で描くと、本体の周りにノイズの小さな破片 (blob) が浮く。ChimeraX の `surface dust` は、表面を
つながった破片に分けて大きさを測り、小さいものを隠す。CueMol の地図の renderer にこの機能を足し、ChX console の
`surface dust` / `surface undust` から使えるようにする。

**着手の条件**: libcuemol2 (`MapSurfRenderer`) の変更が要る。ChX のためだけに入れず、GUI (Density map pane) や
全体でも役に立つか (電顕の地図を GUI で見るときにノイズの破片を隠したい場面があるか、他の機能との重なりは無いか)
を先に確かめ、ユーザーの判断を得てから実装する。それまでは ChX の `surface dust` は今のまま (未対応) とする。

関連:
- 図作りのコーパスの検証 (リポジトリの外の `/Users/user1/proj64/chx-compare/figcorpus/`): 図作りの
  コーパス 32 本のうち 5 本が `surface dust` を使う。段階 B では `surf dust #1 size 20` が
  「`dust` はキーワードではない」というエラーになった。
- [cryo-em-map-mode](../architecture/cryo-em-map-mode.md): EM の地図の全域表示と LoD (この機能が主に効く場面)。

---

## 1. ChimeraX の挙動

確認したもの: `docs/user/commands/surface.html` と `src/bundles/surface/src/dust.py` (ChimeraX のソース)。

```
surface dust <surface-spec> [size s] [metric size | area | volume | "size rank" | "area rank" | "volume rank"] [update true|false]
surface undust <surface-spec>
```

- **破片の単位**: 頂点を共有する三角形をつないだもの (`Blob_Masker` の `blob_list`)。
- **`size`**: 既定は 5。
- **`metric`**:
  - `size` (既定): 破片の頂点を囲む箱の一番長い辺 (Å)。値が `size` より**大きい**破片だけを残す (`greater`)。
  - `area`: 表面積。判定は `size` と同じ。
  - `volume`: 囲む体積。判定は `size` と同じ。
  - `* rank`: 大きい順に `size` 個の破片だけを残す。
- **`update`** (既定 true): 面の形が変わったら (level を変えたときなど) かけ直す。
- **`surface undust`** で解除する。`surface zone` を使ったときも解除される。
- **zone や clip で隠れた部分**: 大きさを測るときは、隠れた部分も含めて測る。

コーパスでの使われ方:
- `surf dust #1 size 20` (gallery_ambient、電顕の地図)。
- `surface dust #1 size 10` (viz_8b0a、電顕の地図)。
- `surface dust #2,3 size 1 metric "size rank"` (recipe_pocket)。この例は `measure contactArea` で作った面が対象で、
  地図ではない。

## 2. CueMol の今

- ChX の `volume ... style surface` は `isosurf` (`MapSurfRenderer`)、`style mesh` は `contour` (`MapMeshRenderer`)
  を使う (`plugins/chimerax-console/worker/commands/mapCommands.ts` の `STYLE_TYPES`)。
- `MapSurfRenderer` は marching cubes の結果を `m_meshCache` に平らに並べる。3 頂点ずつで 1 三角形になり、頂点は
  共有しない (`buildMeshCache()`、`buildGpuMesh()` は `setFace(i, i*3, i*3+1, i*3+2)`)。破片に分けるには、まず
  同じ位置の頂点を同一視する必要がある。
- `MapMeshRenderer` (`contour`) は断面ごとの等高線で、三角形の面を持たない。
- 破片を除く機能は、地図の renderer には無い。`DistFieldSurfBuilder` に「遠い連結成分を除く」処理があるが、
  これは分子表面を作るときの内部処理。

## 3. 方針

### C++ (`MapSurfRenderer`)

- **プロパティを 2 つ足す** (永続化する):
  - `dust_size` (real): 既定は 0。0 は「隠さない」。
  - `dust_metric` (enum): `size` / `size_rank` / `area` / `area_rank` / `volume` / `volume_rank`。既定は `size`。
  - 既定値は `.qsc` に書かれないので、既存のファイルの見え方は変わらない。
- **かける場所**: `buildMeshCache()` で marching cubes の結果を平らに並べた直後に、破片を測り、条件に合わない破片の
  三角形を `m_meshCache` から落とす。
  - プロパティで持つので、level・範囲・LoD が変わって mesh を作り直すたびに、自動でかけ直される。これは ChimeraX
    の `update true` に当たる。
  - 後段 (色付け、GPU mesh、display list の再生) は今のまま、減った `m_meshCache` を使う。
- **頂点の同一視**: 隣のセルと共有する辺の上の頂点は、同じ式で補間されるので、同じ座標になる見込み。座標を
  格子の間隔の 1e-4 程度で量子化した hash で同一視し、union-find で三角形をつなぐ。
  - より確実な方法は、marching cubes の段階で頂点に「どの格子の辺の上か」の key を持たせるもの。量子化で破片が
    割れる例が出たら、こちらに切り替える。
- **大きさの測り方**:
  - `size`: 破片の頂点を囲む箱を、Å の座標 (xform を適用した後) で測る。
  - `area`: 三角形の面積の和。
  - `volume`: 閉じた面の符号付き体積の和。地図の箱の端で開いた破片は、ChimeraX と同じく値が不正確になる。
  - `rank`: 上の値で並べ、上位 `dust_size` 個を残す。
- **ChimeraX と違う点** (受け入れて仕様に書く):
  - 大きさを測るのは、範囲 (box / `volume zone` の境界) と LoD で切り出した後の mesh。ChimeraX は zone で隠れた部分も
    含めて測る。
  - 断面の蓋 (cap) は対象にしない。cap は `generateSurfObj()` の経路だけで使う。
- **`MapMeshRenderer` (`contour`) には足さない**: 面を持たないので、破片という単位が無い。将来、格子の上で
  しきい値を超える点の連結成分を数える方法 (両方の renderer に効く) も考えられるが、今回は扱わない。

### ChX console

- **`surface dust <spec> [size s] [metric ...] [update true|false]`**:
  - spec が指す地図の `isosurf` renderer に `dust_size` と `dust_metric` を書く (`set_node_prop`)。
  - `contour` (mesh) の地図は、「mesh の表示には破片を隠す機能が無い」と言って断る。
  - 分子表面は断る。CueMol の分子表面には等値面のような破片が出にくく、使う場面が無い。
  - `update false` は「CueMol は常にかけ直す」と warn して無視する。
- **`surface undust <spec>`**: `dust_size` を 0 に戻す。
- **`surface zone` との関係**: ChimeraX では zone を使うと dust が解除されるが、ChX にはまだ `surface zone` が無い
  ので、作るときにこの挙動を合わせる。
- 仕様は、実装したときに [console-chimerax-dialect](../architecture/console-chimerax-dialect.md) §6 の表に行を足す。

### GUI (任意。決めること §5)

- Density map pane の isosurf の項目に「Hide dust」(大きさの数値と metric) を足すかどうか。足す場合は form-kit の
  既存部品 (`NumericField` / `SelectField`) で組む。

## 4. テスト (最小)

- **C++ (gtest)**: 1〜2 件。
  - 大きい球と小さい球の 2 つの等値面が出る合成の地図で、`size` では小さい球の三角形だけが落ちること。
    `size_rank 1` では大きい球だけが残ること。
  - `dust_size` の既定値は `.qsc` に書かれず、書いた値は読み戻せること (保存して読み込む往復)。
- **tritium**: 1 件。ChX の `surface dust #1 size 20 metric "size rank"` が、地図の `isosurf` に `dust_size` と
  `dust_metric` を書くこと。mesh と分子表面を断ることは同じテストの中で確かめる。

## 5. 決めること

1. `dust_size` / `dust_metric` を `MapSurfRenderer` のプロパティにすることでよいか。案としては、`MapRenderer` に
   置いて将来 mesh にも効かせる形もある。
2. GUI (Density map pane) にも出すか。出さないなら、ChX と style・プロパティの編集からだけ使う。
3. 頂点の同一視を、まず量子化した hash で作ることでよいか (§3)。
