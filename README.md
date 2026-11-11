[![Build and release](https://github.com/CueMol/cuemol3/actions/workflows/build2.yml/badge.svg)](https://github.com/CueMol/cuemol3/actions/workflows/build2.yml)
[![Build (Linux)](https://github.com/CueMol/cuemol3/actions/workflows/build_linux.yml/badge.svg)](https://github.com/CueMol/cuemol3/actions/workflows/build_linux.yml)

[CueMol](http://www.cuemol.org/) - Molecular Visualization Framework
====================================================================

**CueMol** is a program for visualizing macromolecular structures
(it was formerly called "Que"). It aims to show crystallographic and cryo-EM
models of macromolecules, together with their density maps, through a
user-friendly interface, and to make figures of publication quality.

CueMol reads, among others:

- molecular coordinates: PDB, mmCIF, SDF, GRO
- density maps: CCP4 / MRC, MTZ, X-PLOR / CNS, BRIX
- MSMS surfaces and APBS electrostatic potential maps (OpenDX)
- MD topologies and trajectories: PSF, AMBER prmtop / crd / NetCDF, NAMD coor,
  DCD, XTC, TRR

Applications
--------------------------------------

This repository builds two desktop applications on the same C++ core:

- **CueMol3**: the current application, built with Electron and React. It
  runs on macOS (Apple silicon), Windows (x64) and Linux (x64). Besides the
  GUI it has a command console with its own command language and partial
  PyMOL and ChimeraX dialects, a command line tool (`tritium_cli`) that drives
  the running app, an MCP server for AI agents, and built-in plugins (PDB
  fetch, sequence view, MD trajectories and others).
- **CueMol2**: the earlier application, built on the UXP (Mozilla XULRunner)
  platform. It is still built for macOS and Windows.

Installers for both are published on the
[Releases](https://github.com/CueMol/cuemol3/releases) page. On macOS and
Windows, CueMol3 updates itself from there.

Repository layout
--------------------------------------

| Directory | Contents |
|---|---|
| `src/` | libcuemol2, the C++17 core library (scene, molecular structure, rendering), with Python and Node.js bindings |
| `tritium/` | CueMol3: the Electron + React app (`react-gui/`), the Node.js native addon (`core/`), `tritium_cli` (`cli/`) and the self-updater (`updater/`) |
| `uxp_gui/` | CueMol2: the UXP-based app |
| `build_scripts/` | Build, test and release tasks ([Task](https://taskfile.dev); `task --list`) |
| `docs/` | Architecture notes, migration records and release notes |

Building
--------------------------------------

Recurring operations are Task targets in `build_scripts/`:

```sh
cd build_scripts
task build_libcuemol2    # build and install the C++ core
task build_tritium       # build CueMol3
task run_tritium         # run CueMol3
task test_tritium        # CueMol3 tests
task run_gtest           # C++ unit tests
```

License
--------------------------------------
**CueMol** is distributed with **NO WARRANTY**.
Please use it *at your own risk*.

CueMol (both binaries and source code) is distributed free of charge under the
[MIT License](LICENSE).

If you use CueMol at a commercial organization, you may also use it free of
charge, but we would appreciate it if you could contact us about what you
mainly use it for.
