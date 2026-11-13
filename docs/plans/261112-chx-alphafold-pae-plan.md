# ChimeraX console: AlphaFold の PAE (predicted aligned error) — 実装プラン

## Context

ChimeraX console の AlphaFold まわりは、取得 (`open alphafold:<id>`、`alphafold fetch`)、開いたときの pLDDT の
着色 (分子の coloring を pLDDT の `BfacColoring` にし、paint は `$molcol`。`../architecture/database-fetch.md`)、
値つきの組み込み palette (`palette alphafold` / `pae` など。`../architecture/console-chimerax-dialect.md` §5)
まではできている。残りは PAE:

- `alphafold fetch X pae true`、`alphafold pae #1 colorDomains true` (公式チュートリアル
  "AlphaFold Error Estimates" と、2025 年の Vorländer のチュートリアルで使う)。
- 今は `pae` を warn し、`alphafold_pae:` の fetch を断っている。

**後日の候補** (ユーザー確認済み: 今は実装しない)。PAE のプロット (ヒートマップの GUI) と `alphafold contacts` は
対象外。

## 範囲

| 機能 | 案 |
|---|---|
| PAE の取得 | `alphafold fetch X pae true`、`alphafold pae #1` (引数で `uniprotId`、`file`)、`open alphafold_pae:<id>` |
| ドメインの色分け | `alphafold pae #1 colorDomains true connectMaxPae 5 cluster 0.5 minSize 10` (ChimeraX と同じ既定値) |
| プロット | `plot true` (と、`colorDomains` を付けないときの既定) は「not supported」と warn し、PAE を読み込むだけにする |
| 対象のモデル | AlphaFold DB の単量体 (行 = polymer の残基の順)。行の数と残基の数が合わなければ ChimeraX と同じエラー。AlphaFold 3 / Boltz の、配位子の原子ごとの行は対象外 |

## 実装 (`chimerax-console/worker/pae/`)

- `paeData.ts`: PAE の JSON を読む。3 つの形式 (AFDB v3 以降の `[{predicted_aligned_error}]`、
  v1 / v2 の `residue1 / residue2 / distance`、ColabFold の `{pae}`) を、ChimeraX の
  `read_json_pae_matrix` と同じく float32 の N×N 行列にする。読んだ PAE を object の uid ごとに worker 内の
  Map に持つ (object が消えたら捨てる)。
- `paeDomains.ts`: ChimeraX の `pae_domains` の移植。
  - 行列を `min(P, Pᵀ)`、`max(·, 0.2)` にし、PAE < `connectMaxPae` の組を重み `1/PAE` の辺にしたグラフを作る。
  - networkx 3.x の `greedy_modularity_communities` (Clauset-Newman-Moore、`resolution` = `cluster`) を移植する。
    同点のときは (優先度、(u, v)) の順で比べるので、正しい優先度付きキューなら heap の形によらず同じ順に併合される。
  - ChimeraX は numpy 2 で float32 のまま計算する (NEP 50) ので、`Math.fround` で各演算を float32 に丸めて
    同じ結果にする。結果は大きさの降順。`minSize` 未満のクラスタは捨てる (その残基の色は変えない)。
- `randomColors.ts`: ChimeraX のドメインの色 `random_colors(n, seed=0)` を再現する。numpy の legacy な
  `RandomState.seed(0)` (MT19937 の `init_genrand(0)`) と、uint8 の `randint(0, 255)` (32 bit の乱数を
  下位の byte から順に使い、255 を捨てる) を移植する。手元の numpy 2.0.2 で、先頭の 4 色が
  `[172,10,127] [47,170,196] [117,166,22] [192,204,33]` になることを確かめてある。
- PAE の URL: `worker/shared/dbSources.ts` に `alphafoldPaeUrl(id)` を足す
  (`https://alphafold.ebi.ac.uk/files/AF-<id>-F1-predicted_aligned_error_v<ver>.json`。model と同じ version)。
- コマンド (`commands/alphafoldCommands.ts` を新設し、`alphafold fetch` もここへ移す):
  - `alphafold fetch X pae true`: モデルを開いた後に PAE を取得して、そのモデルに結び付ける。
  - `alphafold pae [#model] [uniprotId X] [file path] [colorDomains bool] [connectMaxPae f] [cluster f]
    [minSize n] [plot bool] [palette] [range] [dividerLines] [version] [ignoreCache]`。uniprotId も file も
    無ければ、結び付いた PAE を使い、それも無ければモデルの名前 (`AF-<UniProt>-F1`) から UniProt id を取って
    取得する。`plot` (既定で true) は warn、palette / range / dividerLines / version / ignoreCache は無視して warn。
  - ドメインの色分け: クラスタごとに、残基の連続した範囲を `resi a:b` の paint entry にして、原子と cartoon に
    上から足す (`paintTarget` の target `ac`)。ChimeraX と同じく、クラスタに入らない残基の色は変えない
    (pLDDT の `$molcol` の行が下に残る)。ChimeraX が付ける `pae_domain` 属性は、CueMol に任意の属性が無いので
    付けない (info で見られない)。
  - `open alphafold_pae:<id>`: 開いているモデルのうち、その UniProt id のものに結び付ける。無ければ ChimeraX と
    同じく「先にモデルを開く」エラー。`openTarget.ts` の `REFUSED` から外す。
- 取得は worker の `fetch` (COLOURlovers の palette と同じ)。

## テスト (最小)

- `paeDomains`: 小さな合成の PAE 行列 (2 つのブロック + ノイズ、30×30 程度) で、クラスタの分け方が networkx の
  結果と一致すること。期待値は手元の networkx 3.6.1 + numpy で作って fixture にする (1 件)。
- `randomColors`: seed 0 の先頭の数色が numpy と一致すること (1 件)。
- `paeData`: 3 つの形式が同じ行列になること (1 件)。
- `alphafold pae colorDomains true`: 結び付いた PAE から、クラスタごとの entry が足されること (1 件)。

## 検証

1. `cd build_scripts && task build_tritium`
2. 前のアプリが残っていないか確かめてから `task run_tritium`
3. ユーザーによる目視確認 (console の ChimeraX dialect で):
   - `alphafold fetch Q86V81 pae true` → `alphafold pae #1 colorDomains true`、`cluster 1` で分け方が変わること
   - チュートリアルの例 (6z03 相当の UniProt) で ChimeraX と同じドメインの分け方と色になること
   - qsc に保存して開き直しても色が残ること
4. 確定後に `npm test`、`npx tsc -p tsconfig.web.json --noEmit`、`tsconfig.node.json`、`task lint_tritium_style`

## ドキュメント (実装後)

- `../architecture/console-chimerax-dialect.md`: `alphafold fetch` の行の `pae`、`alphafold pae` の行、`open` の
  `alphafold_pae`。
- この plan を削除し、`_index.md` の行も消す。
