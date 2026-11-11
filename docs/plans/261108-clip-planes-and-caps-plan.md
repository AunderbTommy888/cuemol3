# 任意の clipping plane と、切った表面の断面の蓋 (cap)

ChimeraX の `clip` (near / far / front / back の 4 枚の面、model ごとの切り替え) と `surface cap` (切った表面の断面に
平らな蓋を描く) と同等のことを、CueMol3 でできるようにする。今の CueMol は、視点の中心の周りの slab (奥行き 1 つ) しか
持たず、向きを自由に決めた面で切ることも、切り口に蓋をすることもできない。

**着手の条件**: libcuemol2 (シェーダー、Scene / Camera、表面の renderer) の変更が要る。ChX のためだけに入れず、GUI でも
役に立つことを確かめ、ユーザーの判断を得てから着手する。GUI で役に立つと見込む理由:
- 断面の図 (タンパク質の表面を切ってポケットや通り道を見せる、電顕の地図を切って中を見せる) は、論文の図でよく使う。
- 今これをするには `cut_surface` (MolSurfObj の `cutByPlane2`) しか無い。これは分子表面のオブジェクトを**壊して**切る
  もので、`dsurface` や地図には効かず、切り直しもできない。clip は壊さず、面を動かせば何度でも切り直せる。
- 薄く切り出してモデルを見る (Coot 風の表示) は、今の slab でも近いことができるが、奥側は fog で薄めるだけで切らない。

関連:
- 図作りのコーパスの検証 (リポジトリの外の `/Users/user1/proj64/chx-compare/figcorpus/`): 図作りのコーパスで
  `clip` は「未対応」として ERROR になっている (trimmings の `symclip`、`centersel`、`cootmode_white`、`caps_on` /
  `caps_off`)。
- [console-chimerax-dialect](../architecture/console-chimerax-dialect.md): 実装したら `clip` と `surface cap` の行を足す。
  `clip` は今 view の名前の予約語としてだけ出てくる (§`view name`)。
- [view-fit](../architecture/view-fit.md)、[gtao-screen-space-ao](../architecture/gtao-screen-space-ao.md)、
  [gpu-id-picking](../architecture/gpu-id-picking.md)、[op-catalog](../architecture/op-catalog.md)。

---

## 1. ChimeraX の挙動

確かめたもの: `docs/user/commands/clip.html`、`docs/user/commands/surface.html` (`surface cap`)、
`src/bundles/graphics/src/clipping.py`、`view.py`、`opengl.py`、`vertexShader.txt`、`src/bundles/surface/src/cap.py`、
`_surface/capper.cpp` (いずれも `/Users/user1/ext/ChimeraX` の下)。

### `clip`

```
clip [near d|off] [far d|off] [front d|off] [back d|off] [position point-spec] [axis vector-spec] [coordinateSystem model-spec]
clip off | ~clip
clip list
clip model model-spec [on|off]
```

- 面は最大 4 枚。
  - **near / far**: 視線に垂直で、**カメラに付いている** (`CameraClipPlane`)。回転しても画面の中で同じ奥行きに残る。
  - **front / back**: **シーンに付いている** (`SceneClipPlane`)。シーンと一緒に回り、向きは自由 (`axis`、既定は作った
    ときの視線の向き)。
- 距離は Å。near / far は視点から遠ざかる向きが正。基準は `position` があればその点、無ければ今の面の位置、面を新しく
  有効にするときは表示中の物の箱の中心。面を off にすると位置は忘れる。
- 引数無しの `clip` は `clip front 0` と同じ。`clip list` は、今の面を再現するコマンドを log に出す。
- `clip model #1 off` は、その model を front / back で切らないようにする (near / far には効かない)。
- 描画: 面は全部 `gl_ClipDistance` で切る (頂点シェーダーで、シーン座標の平面との距離を出す。最大 8 枚)。near / far は
  それに加えて、投影の near / far もその位置まで詰める (`near_far_distances`)。

### `surface cap`

```
surface cap true|false [offset d] [subdivision s] [mesh true|false]
```

- 全体の設定 (model ごとではない)。既定は true。
- 蓋が付くのは、`clip_cap = True` を持つ表面だけ: 分子表面 (SES)、地図の等値面、`shape`、segmentation、読み込んだ
  メッシュ。ribbon や原子 (球・棒) には付かない。mesh 表示にも既定では付かない (`mesh true` で付く)。
- 作り方 (CPU): 表面の三角形と平面の交わりから切り口の線を作り、閉じた輪 (loop) につないで、穴のある多角形として
  三角形に分ける (`calculate_border` + `triangulate_polygon`)。面の位置から `offset` (既定 0.01 Å) だけずらして置く
  (ずらさないと、蓋自体が面で切れて見えなくなる)。
- `subdivision` は蓋の三角形の細かさ。地図の値や zone で蓋を塗るときに効く。
- 面が動くたびに蓋を作り直す (`recalculated_clip_caps`)。

## 2. CueMol の今

### slab

- カメラごとに値 1 つ (`Camera::m_fSlabDepth`、`src/qsys/Camera.hpp:98`)。前後を別に決められない。
- `GUIView::computeSlabPlanes` (`src/qsys/GUIView.cpp:125-145`): 投影の near = 中心 - slab/2、fog は中心から
  中心 + slab/2 まで、投影の far は中心 + slab。**奥側は切らずに fog で消している**。
- `.qsc` にはカメラごとに保存され (`Camera.qif` の `slab`)、カメラの animation でも補間される
  (`src/modules/anim/CamMotion.cpp`)。
- GUI は View pane の「Zoom / Slab」(`features/molview/ViewPane.tsx:262-291`)。

### 描画の経路

- app の画面と PNG の保存は **WebGL2** (`ElecView`、`gfx_manager.ts`)。デスクトップの native (`OcView`) は OpenGL core
  profile。どちらも同じ GLSL を使う。PNG の保存 (`ImgSceneExporter`) は `OffScreenView` で同じ経路を通る。
- WebGL2 には (拡張無しでは) `gl_ClipDistance` が無い。どこでも動くのは、**フラグメントシェーダーでの `discard`**。
- 任意の面で切る仕組みはどこにも無い (`glClipPlane` は build から外れた `GLSLMapVolRenderer.cpp` だけ)。
- ほぼ全部の renderer は GpuPrim (`TrigGpuPrim`、`LineGpuPrim`) を通り、同じシェーダー (`trig_*`、`trigedge_*`、
  `linew*`) を使う。別のシェーダーを持つのは、球・円柱の impostor (`src/modules/molvis/sphere*`、`cylinder*`) と
  地図の mesh (`src/modules/xtal/mapmesh*`、geometry shader あり)。
- renderer ごとの描画の前に `Scene::displayRendImpl` (`src/qsys/Scene.cpp:731-757`) が状態 (xform など) を設定する。
  画面と pick の両方の経路が通るので、renderer ごとの切り替えはここに置ける。

### 関係する処理

- **pick**: 別の pick 用シェーダー (`trig_pick_*`、`linew*_pick_*`、impostor の `PICK_MODE`) で描く。表示のシェーダー
  だけで切ると、見えない部分を pick できてしまう。CPU の当たり判定 (`hitTestImpl`)、矩形・多角形の選択
  (`hitTestRect` / `hitTestPolygon`) も面を知らない。
- **輪郭線**: `trigedge_*` (表面の輪郭・折れ目) と impostor の輪郭のリングは別のパス。ここでも切らないと、切った部分の
  輪郭だけが残る。
- **GTAO**: depth buffer から奥行きを戻すだけなので、`discard` で空いた所はそのまま扱える。
- **裏面**: ライティングは片面 (`lighting_inc.glsl` の `flight2`)、`gl_FrontFacing` を使うシェーダーは無い。
  デスクトップは裏面を culling する (`OcView.cpp:64`)、WebGL はしない。切ると表面の内側 (裏面) が見えるようになる。
- **impostor**: 球・円柱は手前の半球だけを描き、depth の範囲外は既に `discard` している (`sphere_body_frag.glsl:85-91`)。
- **外部レンダラー**: 共通の render setting `clipPlane` (boolean、`RenderSettings.qif:66`) で、slab の near だけを切る。
  - POV-Ray: 球・円柱は `clipped_by { plane }`、メッシュは CPU で切る (`RendIntData::calcMeshClip`、蓋は無し)。
  - umbreon (Embree の path tracer、外部ライブラリ): 視線方向の near / far だけ (`Scene::clipNear` / `clipFar`)。一次光線
    だけを切る。任意の面と蓋は無い。
- **既存の蓋**:
  - `MapSurfRenderer` の `cap_mode`: 地図の**格子の箱の面**に蓋をする (marching cubes のセルの中で作る)。軸に沿った
    箱の面だけなので、任意の面には流用できない。
  - `MolSurfObj::cutByPlane2`: 分子表面を平面で切り、切り口の輪を CGAL の制約付き Delaunay で三角形に分ける
    (`src/modules/surface/CutByPlane2*.cpp`、`Boundary.*`)。輪を追う処理と多角形を三角形に分ける処理は、蓋の生成に
    使える。
- **ChX console**: `clip` は ChimeraX のコマンド名の一覧にあるだけで、「not supported yet」になる。

## 3. 方針

### 3.1 面の持ち方 (C++)

ChimeraX の 2 種類の面に合わせて、置き場所を分ける。

- **シーンに付いた面 (front / back)**: `Scene` に持つ。
  - 1 枚 = 名前、有効か、法線 (world 座標)、面上の点 (world 座標)。名前は `front` / `back` の 2 つから始める
    (シェーダーの上限は 8 枚にしておき、将来増やせるようにする)。
  - `.qsc` に保存する。既定 (面無し) は書かない。
- **カメラに付いた面 (near / far)**: `Camera` に持つ。
  - 1 枚 = 有効か、視点の中心からの奥行きの差 (Å、視点から遠ざかる向きが正)。
  - カメラと一緒に `.qsc` に保存し、カメラの保存・適用・animation (`CamMotion`) でも扱う。
  - **ChimeraX との違い**: ChimeraX は「カメラからの距離」で持つが、CueMol は今の slab と同じく「視点の中心からの差」で
    持つ。中心 (`cofr`) や視点の距離を変えると、面はそれに付いて動く。ChX からは、作るときに中心からの差に直す。
- **slab との関係**: slab はそのまま残す (投影の near / far と fog)。near / far の面は slab とは独立に、その内側を
  さらに切る。ChX で near / far を作るときは、slab がそれより狭くならないように広げる (面より slab が狭いと、
  slab で切れて ChimeraX と違う見た目になる)。
- **renderer ごとの切り替え**: renderer のプロパティ `clip_by_planes` (boolean、既定 true) を足す。false の
  renderer は front / back で切らない (near / far は常に切る。ChimeraX と同じ)。
  - ChimeraX は model ごとだが、CueMol の表面は object の renderer なので、renderer ごとのほうが ChimeraX の
    「表面 (#1.1) だけ切って原子 (#1) は切らない」に合う。

### 3.2 描画 (シェーダー)

- **切り方**: フラグメントシェーダーで、eye 座標の点と面の距離が負なら `discard`。
  - 面は eye 座標の `vec4` (法線、距離) の配列と枚数で渡す。`MatricesBlock` の UBO (`matrices_inc.glsl`) に足すか、
    別の UBO にする。renderer ごとに `Scene::displayRendImpl` で、その renderer に効く面 (front / back は
    `clip_by_planes` を見る) を詰めて渡す。シーンの面は world 座標で持ち、渡すときに view 行列で eye 座標に直す
    (renderer の xform は `u_ModelViewMatrix` に入っているので、頂点の eye 座標はそのまま比べられる)。
  - 頂点シェーダーから eye 座標をフラグメントシェーダーへ渡す varying が要るものは足す。
- **入れるシェーダー** (全部に入れないと、切れ残りや pick の食い違いが出る):
  - `trig_*`、`trigedge_*`、`linew*`。
  - pick 用: `trig_pick_*`、`linew*_pick_*`、impostor の `PICK_MODE`。
  - impostor の球・円柱: 手前の交点が切られた側にあるときは、奥の交点 (内側の面) を求めてそこを描くか、どちらも
    切られていれば `discard`。ChimeraX は球をメッシュで描くので、切ると内側の面が見える。これに合わせる。
  - 地図の mesh (`mapmesh*`)。
- **裏面**: 面が有効な間は culling を止め、ライティングを両面にする (`gl_FrontFacing` で法線を反転)。切った表面の
  内側が黒くならないようにする。面が無いときは今のまま (速さを変えない)。
- **CPU の当たり判定**: `hitTestImpl`、`hitTestRect`、`hitTestPolygon` でも、候補の点を面で落とす。
- 面が 1 枚も無いときは、今と同じシェーダーの経路で、余計な計算をしない (uniform の枚数が 0 で即座に抜ける)。

### 3.3 蓋 (CPU で作る)

GPU の stencil で蓋を描く方法もあるが、CPU で蓋の形 (三角形) を作る。理由:
- ChimeraX と同じ作り方で、蓋の色を場所ごとに変えられる (原子ごとの色、地図の値)。stencil では 1 色になる。
- 蓋が普通のメッシュになるので、PNG の保存だけでなく、POV-Ray や umbreon への書き出しにもそのまま乗る。
- stencil は、デスクトップの off-screen の描画先に stencil が無い (`OcRenderTarget.cpp:118`) など、経路ごとの手当てが
  要る。

作り方:
- **共通の部品**: 「三角形のメッシュと平面 → 蓋の三角形」を作る部品を 1 つ作る。
  - 平面と三角形の交わりの線分を集め、端点を同一視して閉じた輪につなぐ。
  - 輪の包含関係から外周と穴を決め、穴のある多角形を三角形に分ける。`CutByPlane2` の輪の処理と CGAL の制約付き
    Delaunay を流用・一般化する (CGAL は既に依存にある)。
  - 輪が閉じない (表面が閉じていない) 所は、その輪を捨てる (ChimeraX と同じく、蓋が出ないだけにする)。
  - ChimeraX の `capper.cpp` は LGPL なので、写さずに参考にとどめる。
- **対象**: 表面の renderer だけ。
  - `dsurface` (`DirectSurfRenderer`)、`molsurf` (MSMS など、MolSurfObj の renderer)、地図の `isosurf`
    (`MapSurfRenderer`)。
  - 地図の `contour` (mesh) は既定では付けない (ChimeraX の `mesh false`)。
  - ribbon、球・棒、tube は対象にしない (ChimeraX と同じ)。
- **置き場所**: 蓋は renderer が持つ追加の GpuPrim として描き、その renderer の色・透明度・`clip_by_planes` に従う。
  蓋は自分を作った面からは切らない (他の面では切る)。面から `offset` だけ手前にずらす。
- **色**: 蓋の頂点ごとに、その表面と同じ塗り方で色を決める。
  - 原子の色で塗る表面 (`dsurface` の既定) は、蓋の頂点に一番近い原子の色 (既存の `AtomColorMemo` の引き方)。
    切り口の縁の色と蓋の色がつながる。
  - 1 色の表面はその色。地図の値で塗る表面は、蓋の頂点での地図の値で塗る。
  - 色が場所で変わるときだけ、蓋の三角形を細かくする (`subdivision` に当たる)。
- **作り直す時**:
  - シーンの面 (front / back) は、面を動かしたとき、表面を作り直したときだけ。回転では変わらない。
  - カメラの面 (near / far) は、視点を回すたびに切り口が変わる。回転中は作らず (蓋を隠す)、止まったら作り直す。
    大きな表面 (300 万頂点) で 1 回が数百 ms になる見込みなので、毎フレームは作らない (時間は段階 2 の最初に測る)。
- **全体の設定**: `Scene` のプロパティ `clip_cap` (boolean、既定 true) と `clip_cap_offset` (既定 0.01 Å)。
  ChimeraX と同じく全体に 1 つ。`.qsc` に保存する。

### 3.4 外部レンダラー (後の段階)

- PNG の保存は WebGL の経路なので、3.2 と 3.3 でそのまま効く。
- POV-Ray: 球・円柱は `clipped_by { plane }` を面ごとに足す。メッシュは `calcMeshClip` を任意の面に一般化する。
  蓋は 3.3 のメッシュとして出る。
- umbreon (`/Users/user1/proj64/umbreon`、98f5438 で確認):
  - 今あるのは視線方向の `Scene::clipNear` / `clipFar` だけ (`src/umbreon/scene.hpp:454-469`)。一次光線の t の範囲を
    `[clipNear/cosr, clipFar/cosr]` に詰めて切る (`shading/transparency.hpp` の `clipRangeT`)。影・AO・GI の光線は
    切らない (slab は「見え方の道具」で、シーンの形ではないという扱い)。切り口に輪郭線を出さない処理
    (`clipCut`) もある。
  - **near / far の面は、ほぼそのまま使える**: cuemol2 の `UmbreonDisplayContext` (今は slab から near = 中心 - slab/2、
    far = 中心 + slab を渡している) で、カメラの面が有効ならその位置との狭いほうを渡すだけ。umbreon の変更は要らない。
  - **front / back (向きが自由な面) は umbreon に無い**。umbreon に足す形を推す:
    - 平面の半空間はどれも凸なので、光線と全部の面の内側の交わりは 1 つの区間になる。`clipRangeT` を「面ごとに
      光線との交点の t を求めて区間を狭める」形に一般化すれば、今の near / far と同じ経路 (透明の walk、
      `clipCut`、`clipProbeRange`) にそのまま乗る。
    - `clip_by_planes` が false の renderer (面で切らない物) は、この区間を無視して当たらなければならない。Embree の
      geometry ごとの印 (mask か filter 関数) で「切る物」と「切らない物」を分け、切らない物は区間の外でも当てる。
      ここは今の near / far に無い仕組みで、手間の大半はここ。
    - **影・AO を切るか**を決める必要がある。near / far は今どおり切らない。一方、front / back で切り取った部分が
      影や AO を落とし続けると、切って見せたポケットの中が暗くなり、「取り除いた」見た目にならない。front / back
      は二次光線も切る (切った物は無いものとして扱う) のを推す。
  - cuemol2 側で形を CPU で切って渡す案 (メッシュは切り、球・円柱は面に掛かるものだけメッシュにする) は、umbreon を
    変えずに済むが、球・円柱の解析的な形を捨てることになり、絵と速さが落ちるので推さない。
  - 段階 4 で umbreon に入るまでは、「umbreon は front / back を無視する」と render のダイアログで伝える。蓋は
    3.3 のメッシュとして渡るので、その時点でも umbreon に出る (ただし切られていない本体の中に埋もれる)。
- render setting の `clipPlane` (slab の near で切るか) はそのまま残し、front / back と near / far の面は常に効かせる。

### 3.5 op と GUI

- **op** (op catalog と action log に行を足す。1 回の op = 1 回の undo):
  - `set_clip_plane {name, enabled, normal?, point?, offset?}`: front / back / near / far を作る・動かす・消す。
  - `clear_clip_planes`、`list_clip_planes`。
  - renderer の `clip_by_planes` と scene の `clip_cap` / `clip_cap_offset` は、既存の `set_node_prop` で書く。
- **GUI**:
  - View pane に「Clipping」の項目: front / back の有効、今の視線の向きで置き直すボタン、位置の数値 (中心からの差)、
    near / far の有効と数値、「Cap surfaces」のスイッチ。form-kit の既存部品 (`SwitchField`、`DragNumericField`、
    `FormButton`) で組む。
  - renderer のプロパティに「Clip by planes」。
  - マウスで面を動かす操作 (ChimeraX の clip の mouse mode) は、この計画では扱わない。

### 3.6 ChX console

- **`clip`**:
  - `near` / `far`: 視点の中心からの差に直して、カメラの面を作る。基準は `position` (点の spec)、無ければ今の面、新しい
    面は表示中の物の箱の中心。slab が面より狭ければ広げる。
  - `front` / `back`: シーンの面を作る。法線は `axis` (x / y / z、ベクトル)、無ければ今の視線の向き。
    `coordinateSystem` があればその model の座標で読む。
  - `off` (面ごと、全体)、`~clip`、引数無し (`clip front 0`)、`clip list` (再現するコマンドを出す)。
  - `clip model <spec> on|off`: spec が指す renderer の `clip_by_planes` を書く。ChX で表面がどの model 番号に
    当たるか (ChimeraX の `#1.1`) は、今の ChX の model の数え方に合わせる。
- **`surface cap true|false [offset d] [subdivision s] [mesh true|false]`**: scene の `clip_cap` /
  `clip_cap_offset` を書く。`subdivision` は「CueMol は色に合わせて自動で決める」と warn して無視する。
  `mesh true` は「mesh の地図には蓋を付けない」と warn する。
- これで trimmings の `symclip`、`centersel`、`caps_on` / `caps_off`、`cootmode_white` の `clip` と `surface cap` の
  部分が通る。

## 4. 段階

1. **面と切る処理**: 3.1、3.2 (pick と CPU の当たり判定を含む)、op、ChX の `clip`。これだけで、蓋の無い ChimeraX の
   `clip` と同じ見た目になる。
2. **蓋**: 3.3、ChX の `surface cap`。
3. **GUI**: 3.5 の View pane とプロパティ。
4. **外部レンダラー**: 3.4。

段階ごとに PR を分け、1 つマージしてから次に進む。

## 5. テスト (最小)

- **C++ (gtest)**:
  - 面の保存と読み込み: シーンの面、カメラの面、renderer の `clip_by_planes`、`clip_cap` が `.qsc` の往復で残り、
    既定値は書かれないこと。
  - 蓋の部品: 穴のある切り口になるメッシュ (中空の立方体など) を平面で切り、蓋の面積が期待値に合い、穴の部分に
    三角形が無いこと。閉じていない輪は捨てること。
- **tritium**:
  - ChX の `clip near -10 far 10 position <点>`、`clip front 0 axis x`、`clip model #1 off`、`clip list` が出す op の
    列と、`clip list` の出力をそのまま流すと同じ面になること (1 件にまとめる)。
- 見た目 (切り口、裏面、輪郭線、pick) はユーザーの目視で確かめ、テストにしない。

## 6. 決めること

1. カメラの面 (near / far) を `Camera` に持つ (カメラの保存・animation に乗る) か、`View` に持つ (保存しない) か。
   この計画は `Camera` を推す (図の視点の保存で切り方も戻るほうが便利)。
2. renderer ごとの `clip_by_planes` でよいか (ChimeraX は model ごと)。
3. impostor の球・円柱を切ったときに、内側の面を描く (ChimeraX と同じ見た目) か、切った部分を単に消すか。前者は
   シェーダーで奥の交点を求める分だけ手間が増える。
4. 蓋の色: 原子の色で塗る表面で、蓋の頂点に一番近い原子の色を使うことでよいか。
5. umbreon の front / back を umbreon 側に足すこと (3.4 の推し) でよいか。そのとき、切った部分の影・AO も消すか
   (推しは消す。near / far は今どおり消さない)。段階 4 で決めてもよい。
