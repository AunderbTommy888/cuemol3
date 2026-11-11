# ChX console: nucl の Base type の None と `nucleotides` のずれを直す

inspector の nucl renderer の Base type に None が入った (`base_type = basepair` + `base_size = 0`。仕様は
`../architecture/tube-gpu-mesh.md` の NARenderer の節)。ChX console はこれをまだ知らないので、`chx:nuclbase` を
inspector で None にすると、`nucleotides` のコマンドとずれる。

## 今のずれ (`plugins/chimerax-console/worker/`)

- `display.ts` の `baseMode` は `base_type` しか見ないので、None を ladder と判定する。
- `displayCommands.ts` の `setBaseMode` は `base_type` しか書かない:
  - `nucleotides ladder` を打っても `base_size = 0` のままで、base は戻らない。
  - `nucleotides slab` は `detail1` にするので、`base_thick` が正なら環の板だけが出る (棒は出ない)。

## 直し方

- `baseMode`: None (`basepair` かつ `base_size === 0`) なら、base が描かれていないので `atoms` を返す。
- `setBaseMode`: slab / ladder にするとき、`base_size === 0` なら、`base_size` と `base_thick` を entry の既定値
  (`defaultValue`) に戻す書き込みを足す (op に reset が無いので `set_node_prop` で既定値を書く)。
- テスト: 既存の `nucleotides` のテストに、`base_size = 0` の状態から slab にすると既定の太さが書かれることを足す。
