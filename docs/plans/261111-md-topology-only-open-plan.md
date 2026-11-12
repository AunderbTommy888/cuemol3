# MD trajectory: topology だけを分子として開く

落とした trajectory を既存の分子に付ける機能 ([../architecture/md-trajectory-attach-on-drop.md](../architecture/md-trajectory-attach-on-drop.md)、
実装済み) の前段。PyMOL のように「topology を開く -> trajectory を付ける」の流れを、座標を持たない topology でも
できるようにする。

## 1. 今の状態

| topology | 普通の File > Open | 座標 |
|---|---|---|
| `.gro` | 開ける (普通の分子) | ある |
| AMBER `prmtop` (`amberprm`) | 開ける (File Open Option で coord のファイルを任意で指定) | coord が無いと、全原子が原点に重なる (点に見え、二次構造も無い) |
| NAMD `.coor` + PSF (`namdcoor`) | 開ける (PSF を sub-stream で指定) | ある |
| PSF 単独 | 開けない (`PsfReader` は ObjReader ではない) | 無い |

- `.gro` はもう PyMOL と同じ流れで使える (drop のプランができれば、`.gro` を開いて `.xtc` を付けられる)。
- 問題は座標の無い topology: 開けても画面では何も分からない (全原子が原点)。読み込めたかどうかが分かりにくい。
- `loadTrajectory` の topology は `gro` だけだが、`amberprm` も `Trajectory` に attach すれば動く見込み (frame 0 で
  座標が置き換わる)。

## 2. 方針

### 2.1 座標の無い topology を「座標なし」として開く

- `prmtop` を coord 無しで開いたとき:
  - 分子は作るが、view を合わせない (原点の 1 点に合わせても意味が無い)。
  - 最初の renderer を作らない、または作っても見えないので、scene tree で分かるように、object の行に「no
    coordinates」の印を付ける。
  - 開いた直後に、log と通知 (toast) で「<名前>: N atoms を読んだ (座標なし)。trajectory を落として付ける」と出す。
- 「座標なし」の判定: reader の結果から決める (例: `amberprm` で coord の sub-stream が無い)。worker の開く service が
  結果に `noCoords: true` を返し、UI はそれで印と通知を出す。判定を C++ に持たせる (object の property) か TS で
  済ませるかは §4 で決める。

### 2.2 drop のプランとつなぐ

- 付け先のダイアログ (drop のプラン) では、「座標なし」の分子も候補に出す。付けると frame 0 の座標が入って見える
  ようになる。
- 変換 (XML の往復で `Trajectory` にする) は、`prmtop` の元の reader で読み直すので、原子の順番はファイルの順番の
  まま。

### 2.3 OpenMdTrajDialog の topology を広げる

- topology の欄で `.prmtop` / `.parm7` も選べるようにし、`loadTrajectory` は拡張子で topology の reader を選ぶ
  (`gro` / `amberprm`)。`amberprm` を `Trajectory` に attach して動くことを、C++ のテストで確かめる。

### 2.4 対象外

- PSF 単独の topology: 専用の ObjReader (`PsfTrajReader`、`260718-md-trajectory-phase2-plan.md` で保留) が要る
  (C++ の新しい reader)。必要になったら別に計画する。

## 3. テスト (最小)

- worker: coord 無しの `prmtop` を開くと `noCoords: true` が返り、view を合わせないこと。
- C++: `amberprm` を `Trajectory` に attach してから dcd / nc の block を足せること (`test_trajio.cpp` に 1 件)。

## 4. 決めること

- 座標の無い topology を、そもそも普通の File > Open で開けるようにするか (今も開けるが分かりにくい)、それとも
  MD 用の流れ (OpenMdTrajDialog と drop の付け先) だけにするか。
- 「座標なし」の判定と印を、C++ (object の property) と TS のどちらに持たせるか。
- 最初の renderer を作るか (作るなら、frame 0 が入ると見えるようになる)。
