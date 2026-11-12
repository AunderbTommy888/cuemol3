#include <gtest/gtest.h>
#include <common.h>

#include "mdtools/AmberPrmtopReader.hpp"
#include "mdtools/AmberCrdReader.hpp"
#include "mdtools/AmberRstTrajReader.hpp"
#include "mdtools/Trajectory.hpp"
#include "mdtools/TrajBlock.hpp"
#include "molstr/MolCoord.hpp"
#include "molstr/MolAtom.hpp"
#include "molstr/MolBond.hpp"
#include "molstr/MolResidue.hpp"
#include "molstr/ElemSym.hpp"
#include "molstr/ResidIndex.hpp"
#include "symm/CrystalInfo.hpp"

#include <qlib/LString.hpp>
#include <qlib/LExceptions.hpp>
#include <qlib/StringStream.hpp>
#include <qlib/Vector4D.hpp>
#include <qsys/Object.hpp>
#include <qsys/Scene.hpp>
#include <qsys/SceneManager.hpp>
#include <qsys/SceneXMLReader.hpp>
#include <qsys/SceneXMLWriter.hpp>
#include <qsys/StreamManager.hpp>
#include <qlib/LByteArray.hpp>

#include <filesystem>
#include <fstream>
#include <string>

using mdtools::AmberPrmtopReader;
using mdtools::AmberCrdReader;
using molstr::MolCoord;
using molstr::MolCoordPtr;
using molstr::MolAtomPtr;
using molstr::MolBond;
using molstr::ElemSym;
using qlib::LString;
using qlib::StrInStream;

namespace {

// Minimal valid AMBER 7+ prmtop for a single 3-atom water (WAT).
// Atoms: OW, HW1, HW2.
// Bonds (in BONDS_INC_HYDROGEN, encoded as atom_index*3):
//   OW-HW1: 0, 3, parm_idx=1
//   OW-HW2: 0, 6, parm_idx=1
// POINTERS layout per the AMBER prmtop spec; only the fields we read
// (NATOM=3, NBONH=2, MBONA=0, NRES=1, IFBOX=0) need correct values.
const char *const kPrmtopWater =
    "%VERSION  VERSION_STAMP = V0001.000  DATE = 01/01/24  00:00:00\n"
    "%FLAG TITLE\n"
    "%FORMAT(20a4)\n"
    "water test\n"
    "%FLAG POINTERS\n"
    "%FORMAT(10I8)\n"
    "       3       2       2       0       0       0       0       0       0       0\n"
    "       0       1       0       0       0       0       0       0       0       0\n"
    "       0       0       0       0       0       0       0       0       3       0\n"
    "       0\n"
    "%FLAG ATOM_NAME\n"
    "%FORMAT(20a4)\n"
    "OW  HW1 HW2 \n"
    "%FLAG CHARGE\n"
    "%FORMAT(5E16.8)\n"
    " -8.34000000E-01  4.17000000E-01  4.17000000E-01\n"
    "%FLAG ATOMIC_NUMBER\n"
    "%FORMAT(10I8)\n"
    "       8       1       1\n"
    "%FLAG MASS\n"
    "%FORMAT(5E16.8)\n"
    "  1.60000000E+01  1.00800000E+00  1.00800000E+00\n"
    "%FLAG RESIDUE_LABEL\n"
    "%FORMAT(20a4)\n"
    "WAT \n"
    "%FLAG RESIDUE_POINTER\n"
    "%FORMAT(10I8)\n"
    "       1\n"
    "%FLAG BONDS_INC_HYDROGEN\n"
    "%FORMAT(10I8)\n"
    "       0       3       1       0       6       1\n"
    "%FLAG BONDS_WITHOUT_HYDROGEN\n"
    "%FORMAT(10I8)\n"
    "%FLAG AMBER_ATOM_TYPE\n"
    "%FORMAT(20a4)\n"
    "OW  HW  HW  \n";

// Same as kPrmtopWater but without ATOMIC_NUMBER -- exercise the
// MASS-based element fallback (Amber 7-11 era).
const char *const kPrmtopWaterNoAtomicNumber =
    "%VERSION  VERSION_STAMP = V0001.000  DATE = 01/01/24  00:00:00\n"
    "%FLAG TITLE\n"
    "%FORMAT(20a4)\n"
    "water test\n"
    "%FLAG POINTERS\n"
    "%FORMAT(10I8)\n"
    "       3       2       2       0       0       0       0       0       0       0\n"
    "       0       1       0       0       0       0       0       0       0       0\n"
    "       0       0       0       0       0       0       0       0       3       0\n"
    "       0\n"
    "%FLAG ATOM_NAME\n"
    "%FORMAT(20a4)\n"
    "OW  HW1 HW2 \n"
    "%FLAG CHARGE\n"
    "%FORMAT(5E16.8)\n"
    " -8.34000000E-01  4.17000000E-01  4.17000000E-01\n"
    "%FLAG MASS\n"
    "%FORMAT(5E16.8)\n"
    "  1.60000000E+01  1.00800000E+00  1.00800000E+00\n"
    "%FLAG RESIDUE_LABEL\n"
    "%FORMAT(20a4)\n"
    "WAT \n"
    "%FLAG RESIDUE_POINTER\n"
    "%FORMAT(10I8)\n"
    "       1\n"
    "%FLAG BONDS_INC_HYDROGEN\n"
    "%FORMAT(10I8)\n"
    "       0       3       1       0       6       1\n"
    "%FLAG BONDS_WITHOUT_HYDROGEN\n"
    "%FORMAT(10I8)\n"
    "%FLAG AMBER_ATOM_TYPE\n"
    "%FORMAT(20a4)\n"
    "OW  HW  HW  \n";

// Pre-Amber-7 (label-less) prmtop. Must be rejected with FileFormatException.
const char *const kOldPrmtop =
    "test\n"
    "    3    1    2    0    0    0    0    0    0    0\n"
    "    0    1    0    0    0    0    0    0    0    0\n";

// AMBER ASCII restart for the 3-atom water, no velocities, no box.
// FORMAT(6F12.7): each value is exactly 12 chars wide.
const char *const kInpcrdWater =
    "water restart\n"
    "    3\n"
    "   1.0000000   2.0000000   3.0000000   1.5000000   2.0000000   3.0000000\n"
    "   1.0000000   2.5000000   3.0000000\n";

// Restart with periodic box (a=10, b=11, c=12, alpha=beta=gamma=90).
const char *const kInpcrdWaterBox =
    "water restart with box\n"
    "    3\n"
    "   1.0000000   2.0000000   3.0000000   1.5000000   2.0000000   3.0000000\n"
    "   1.0000000   2.5000000   3.0000000\n"
    "  10.0000000  11.0000000  12.0000000  90.0000000  90.0000000  90.0000000\n";

// Restart with wrong NATOM (should fail when applied to a 3-atom MolCoord).
const char *const kInpcrdBadNatom =
    "wrong natom\n"
    "    5\n"
    "   1.0000000   2.0000000   3.0000000   1.5000000   2.0000000   3.0000000\n";

LString writeTempFile(const std::string &suffix, const char *payload)
{
    static int s_counter = 0;
    const std::string dir = ::testing::TempDir();
    const std::string path =
        dir + "/amber_test_" + std::to_string(++s_counter) + suffix;
    std::ofstream out(path, std::ios::binary);
    out << payload;
    out.close();
    return LString(path.c_str());
}

// Build a 3-atom MolCoord by hand so AmberCrdReader can be tested standalone.
MolCoordPtr makeThreeAtomMol()
{
    MolCoordPtr pMol(MB_NEW MolCoord());
    for (int i = 0; i < 3; ++i) {
        MolAtomPtr pAtom = MolAtomPtr(MB_NEW molstr::MolAtom());
        pAtom->setParentUID(pMol->getUID());
        pAtom->setName(LString::format("A%d", i));
        pAtom->setElement(ElemSym::C);
        pAtom->setChainName("A");
        pAtom->setResIndex(molstr::ResidIndex(1));
        pAtom->setResName("RES");
        pMol->appendAtom(pAtom);
    }
    return pMol;
}

}  // namespace

// ---- AmberCrdReader standalone: positions applied correctly ----

TEST(AmberCrdReaderTest, PositionsAppliedToExistingMolCoord)
{
    MolCoordPtr pMol = makeThreeAtomMol();
    ASSERT_EQ(pMol->getAtomSize(), 3);

    AmberCrdReader crd;
    crd.attach(pMol);
    StrInStream ins(kInpcrdWater, static_cast<int>(std::string(kInpcrdWater).size()));
    crd.read(ins);

    qlib::Vector4D p0 = pMol->getAtom(0)->getPos();
    EXPECT_NEAR(p0.x(), 1.0, 1e-6);
    EXPECT_NEAR(p0.y(), 2.0, 1e-6);
    EXPECT_NEAR(p0.z(), 3.0, 1e-6);

    qlib::Vector4D p1 = pMol->getAtom(1)->getPos();
    EXPECT_NEAR(p1.x(), 1.5, 1e-6);
    EXPECT_NEAR(p1.y(), 2.0, 1e-6);
    EXPECT_NEAR(p1.z(), 3.0, 1e-6);

    qlib::Vector4D p2 = pMol->getAtom(2)->getPos();
    EXPECT_NEAR(p2.x(), 1.0, 1e-6);
    EXPECT_NEAR(p2.y(), 2.5, 1e-6);
    EXPECT_NEAR(p2.z(), 3.0, 1e-6);
}

// ---- AmberCrdReader: box block is detected and attached to CrystalInfo ----

TEST(AmberCrdReaderTest, BoxAttachesCrystalInfo)
{
    MolCoordPtr pMol = makeThreeAtomMol();

    AmberCrdReader crd;
    crd.attach(pMol);
    StrInStream ins(kInpcrdWaterBox, static_cast<int>(std::string(kInpcrdWaterBox).size()));
    crd.read(ins);

    symm::CrystalInfoPtr pci = pMol->getExtData("CrystalInfo");
    ASSERT_FALSE(pci.isnull());
    EXPECT_NEAR(pci->a(), 10.0, 1e-6);
    EXPECT_NEAR(pci->b(), 11.0, 1e-6);
    EXPECT_NEAR(pci->c(), 12.0, 1e-6);
    EXPECT_NEAR(pci->alpha(), 90.0, 1e-6);
    EXPECT_NEAR(pci->beta(),  90.0, 1e-6);
    EXPECT_NEAR(pci->gamma(), 90.0, 1e-6);
}

// ---- AmberCrdReader: natom mismatch must throw ----

TEST(AmberCrdReaderTest, NatomMismatchThrows)
{
    MolCoordPtr pMol = makeThreeAtomMol();

    AmberCrdReader crd;
    crd.attach(pMol);
    StrInStream ins(kInpcrdBadNatom, static_cast<int>(std::string(kInpcrdBadNatom).size()));
    EXPECT_THROW(crd.read(ins), qlib::FileFormatException);
}

// ---- Full integration: prmtop main + inpcrd sub-stream ----

namespace {

// Run reader.load(prmtop_text) after setting "coord" to a temp inpcrd path.
// This mirrors the GROFileReader test pattern (which uses load(StrInStream))
// while still exercising the createInStream("coord") sub-stream path.
MolCoordPtr loadAmber(AmberPrmtopReader &reader,
                      const char *prmtop_text, const char *inpcrd_text)
{
    LString inpcrd_path = writeTempFile(".inpcrd", inpcrd_text);
    reader.setPath(LString("coord"), inpcrd_path);

    StrInStream ins(prmtop_text, static_cast<int>(std::string(prmtop_text).size()));
    qsys::ObjectPtr pObj = reader.load(ins);
    return MolCoordPtr(pObj);
}

}  // namespace

TEST(AmberPrmtopReaderTest, FullLoadBuildsMolWithBondsAndCoords)
{
    AmberPrmtopReader reader;
    MolCoordPtr pMol = loadAmber(reader, kPrmtopWater, kInpcrdWater);
    ASSERT_FALSE(pMol.isnull());

    EXPECT_EQ(pMol->getAtomSize(), 3);

    EXPECT_EQ(pMol->getAtom(0)->getName(), LString("OW"));
    EXPECT_EQ(pMol->getAtom(1)->getName(), LString("HW1"));
    EXPECT_EQ(pMol->getAtom(2)->getName(), LString("HW2"));

    EXPECT_EQ(pMol->getAtom(0)->getElement(), ElemSym::O);
    EXPECT_EQ(pMol->getAtom(1)->getElement(), ElemSym::H);
    EXPECT_EQ(pMol->getAtom(2)->getElement(), ElemSym::H);

    EXPECT_EQ(pMol->getAtom(0)->getResName(), LString("WAT"));

    // Verify the two prmtop-declared bonds (OW-HW1, OW-HW2) are present.
    // applyTopology() may autogenerate additional bonds for known residues,
    // so the total bond count is >= 2 rather than == 2. The key invariant
    // under test here is that the /3 index conversion correctly maps the
    // raw bond indices (0, 3) and (0, 6) to atom pairs (0, 1) and (0, 2).
    bool found_0_1 = false;
    bool found_0_2 = false;
    for (auto it = pMol->beginBond(); it != pMol->endBond(); ++it) {
        const MolBond *pBond = it->second;
        if (pBond == nullptr) continue;
        int a = pBond->getAtom1();
        int b = pBond->getAtom2();
        if ((a == 0 && b == 1) || (a == 1 && b == 0)) found_0_1 = true;
        if ((a == 0 && b == 2) || (a == 2 && b == 0)) found_0_2 = true;
    }
    EXPECT_TRUE(found_0_1);
    EXPECT_TRUE(found_0_2);

    // Coordinates from inpcrd (sub-stream) applied to existing atoms.
    qlib::Vector4D p0 = pMol->getAtom(0)->getPos();
    EXPECT_NEAR(p0.x(), 1.0, 1e-6);
    EXPECT_NEAR(p0.y(), 2.0, 1e-6);
    EXPECT_NEAR(p0.z(), 3.0, 1e-6);
}

// ---- Element resolution falls back to MASS when ATOMIC_NUMBER absent ----

TEST(AmberPrmtopReaderTest, MassFallbackResolvesElement)
{
    AmberPrmtopReader reader;
    MolCoordPtr pMol = loadAmber(reader, kPrmtopWaterNoAtomicNumber, kInpcrdWater);
    ASSERT_FALSE(pMol.isnull());

    EXPECT_EQ(pMol->getAtomSize(), 3);
    EXPECT_EQ(pMol->getAtom(0)->getElement(), ElemSym::O);
    EXPECT_EQ(pMol->getAtom(1)->getElement(), ElemSym::H);
    EXPECT_EQ(pMol->getAtom(2)->getElement(), ElemSym::H);
}

// ---- Topology-only load: prmtop without "coord" sub-stream succeeds ----
//
// The UI lets the user open a prmtop file without picking an inpcrd. In that
// case the load completes with topology (atoms, residues, bonds) and the
// atoms keep their default (zero) positions until coordinates are applied.

TEST(AmberPrmtopReaderTest, TopologyOnlyLoadSucceeds)
{
    AmberPrmtopReader reader;
    // Intentionally do NOT call setPath("coord", ...).

    StrInStream ins(kPrmtopWater, static_cast<int>(std::string(kPrmtopWater).size()));
    qsys::ObjectPtr pObj;
    ASSERT_NO_THROW(pObj = reader.load(ins));

    MolCoordPtr pMol(pObj);
    ASSERT_FALSE(pMol.isnull());
    EXPECT_EQ(pMol->getAtomSize(), 3);
    EXPECT_EQ(pMol->getAtom(0)->getName(), LString("OW"));
}

// ---- Old format (pre-Amber-7) is rejected ----

TEST(AmberPrmtopReaderTest, OldFormatRejected)
{
    LString inpcrd_path = writeTempFile(".inpcrd", kInpcrdWater);

    AmberPrmtopReader reader;
    reader.setPath(LString("coord"), inpcrd_path);

    StrInStream ins(kOldPrmtop, static_cast<int>(std::string(kOldPrmtop).size()));
    EXPECT_THROW(reader.load(ins), qlib::FileFormatException);
}

// ---- bondmode reader option (file-authoritative bonds by default) ----

TEST(AmberPrmtopReaderTest, BondmodeDefaultsToFile)
{
    AmberPrmtopReader reader;
    EXPECT_EQ(reader.getBondMode(), AmberPrmtopReader::BONDMODE_FILE);
}

// Default "file" mode marks residues "noautogen" (the bond-aware-format
// convention) so applyTopology() does not distance-autogen bonds -- avoiding
// spurious / zero-coordinate bonds. Verify the marker is set and the file
// bonds survive a coordinate-less (topology-only) load.
TEST(AmberPrmtopReaderTest, FileBondModeSetsNoautogenMarker)
{
    AmberPrmtopReader reader;  // default bondmode == file
    // Topology-only load (no "coord" sub-stream): atoms stay at the origin.
    StrInStream ins(kPrmtopWater, static_cast<int>(std::string(kPrmtopWater).size()));
    qsys::ObjectPtr pObj = reader.load(ins);
    MolCoordPtr pMol(pObj);
    ASSERT_FALSE(pMol.isnull());

    molstr::MolResiduePtr pRes = pMol->getResidue("A", molstr::ResidIndex(1));
    ASSERT_FALSE(pRes.isnull());
    LString noautogen;
    pRes->getPropStr("noautogen", noautogen);
    EXPECT_TRUE(noautogen.equals("true"));

    // File-declared bonds present; coordinate-less atoms remain at the origin.
    bool found_0_1 = false, found_0_2 = false;
    for (auto it = pMol->beginBond(); it != pMol->endBond(); ++it) {
        const MolBond *pBond = it->second;
        if (pBond == nullptr) continue;
        int a = pBond->getAtom1(), b = pBond->getAtom2();
        if ((a == 0 && b == 1) || (a == 1 && b == 0)) found_0_1 = true;
        if ((a == 0 && b == 2) || (a == 2 && b == 0)) found_0_2 = true;
    }
    EXPECT_TRUE(found_0_1);
    EXPECT_TRUE(found_0_2);

    qlib::Vector4D p0 = pMol->getAtom(0)->getPos();
    EXPECT_NEAR(p0.x(), 0.0, 1e-9);
    EXPECT_NEAR(p0.y(), 0.0, 1e-9);
    EXPECT_NEAR(p0.z(), 0.0, 1e-9);
}

// The "autogen" mode does not set the noautogen marker, so the reader option
// demonstrably changes behaviour (bonds come from applyTopology, PDB-like).
TEST(AmberPrmtopReaderTest, AutogenBondModeClearsNoautogenMarker)
{
    AmberPrmtopReader reader;
    reader.setBondMode(AmberPrmtopReader::BONDMODE_AUTOGEN);

    StrInStream ins(kPrmtopWater, static_cast<int>(std::string(kPrmtopWater).size()));
    MolCoordPtr pMol(reader.load(ins));
    ASSERT_FALSE(pMol.isnull());

    molstr::MolResiduePtr pRes = pMol->getResidue("A", molstr::ResidIndex(1));
    ASSERT_FALSE(pRes.isnull());
    LString noautogen;
    pRes->getPropStr("noautogen", noautogen);
    EXPECT_FALSE(noautogen.equals("true"));
}

// ---- qsc round trips (a scene file away from the working directory) ----

namespace {

// A second restart for the water, every coordinate shifted by +10.
const char *const kInpcrdWaterShifted =
    "water restart shifted\n"
    "    3\n"
    "  11.0000000  12.0000000  13.0000000  11.5000000  12.0000000  13.0000000\n"
    "  11.0000000  12.5000000  13.0000000\n";

// A fresh directory under the temp dir (not the working directory, so a path
// left relative to the scene file would not be found from the cwd).
std::filesystem::path makeQscDir(const char *name)
{
    const std::filesystem::path dir = std::filesystem::temp_directory_path() / name;
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    return dir;
}

std::string writeIn(const std::filesystem::path &dir, const char *fname, const char *payload)
{
    const std::string path = (dir / fname).string();
    std::ofstream(path, std::ios::binary) << payload;
    return path;
}

void saveScene(const qsys::ScenePtr &pScene, const std::string &path)
{
    qsys::SceneXMLWriter w;
    w.setPath(path.c_str());
    w.attach(pScene);
    w.write();
    w.detach();
}

qsys::ScenePtr loadScene(const std::string &path)
{
    qsys::ScenePtr pScene = qsys::SceneManager::getInstance()->createScene();
    qsys::SceneXMLReader r;
    r.setPath(path.c_str());
    r.attach(pScene);
    r.read();
    r.detach();
    EXPECT_TRUE(r.getErrMsg().isEmpty()) << r.getErrMsg().c_str();
    return pScene;
}

qlib::Vector4D firstAtomPos(const MolCoordPtr &pMol)
{
    return pMol->beginAtom()->second->getPos();
}

}  // namespace

// A topology-only prmtop takes its coordinates as AMBER restart blocks (one
// frame each), which a .qsc stores as references and reads back: the
// Trajectory is two files of one kind each, with no reader sub-stream.
TEST(AmberRstTrajReaderTest, RestartBlocksFollowTopologyOnlyPrmtopAcrossQsc)
{
    const std::filesystem::path dir = makeQscDir("amberrst_qsc");
    const std::string prmtop = writeIn(dir, "water.prmtop", kPrmtopWater);
    const std::string rst0 = writeIn(dir, "water0.rst7", kInpcrdWater);
    const std::string rst1 = writeIn(dir, "water1.rst7", kInpcrdWaterShifted);
    const std::string qsc = (dir / "water.qsc").string();

    qsys::ScenePtr pScene = qsys::SceneManager::getInstance()->createScene();
    mdtools::TrajectoryPtr pTraj(MB_NEW mdtools::Trajectory());
    {
        AmberPrmtopReader topo;
        topo.attach(pTraj);
        topo.setPath(prmtop.c_str());
        topo.qsys::ObjReader::read();
        topo.detach();
    }
    pScene->addObject(pTraj);

    for (const std::string &rst : {rst0, rst1}) {
        mdtools::AmberRstTrajReader rr;
        rr.setPath(rst.c_str());
        EXPECT_EQ(rr.getFileAtomCount(), 3);
        rr.setTargTrajUID(pTraj->getUID());
        mdtools::TrajBlockPtr pBlk(rr.createDefaultObj());
        rr.attach(pBlk);
        rr.qsys::ObjReader::read();
        rr.detach();
        pTraj->append(pBlk);
    }
    ASSERT_EQ(pTraj->getFrameSize(), 2);
    pTraj->setFrame(1);
    EXPECT_NEAR(firstAtomPos(pTraj).x(), 11.0, 1e-4);
    pTraj->setFrame(0);
    EXPECT_NEAR(firstAtomPos(pTraj).x(), 1.0, 1e-4);
    EXPECT_NEAR(firstAtomPos(pTraj).z(), 3.0, 1e-4);

    saveScene(pScene, qsc);
    qsys::ScenePtr pScene2 = loadScene(qsc);
    ASSERT_EQ(pScene2->getObjectCount(), 1);
    mdtools::TrajectoryPtr pTraj2(pScene2->beginObj()->second, qlib::no_throw_tag());
    ASSERT_FALSE(pTraj2.isnull());
    ASSERT_EQ(pTraj2->getFrameSize(), 2);
    pTraj2->setFrame(0);
    EXPECT_NEAR(firstAtomPos(pTraj2).x(), 1.0, 1e-4);
    EXPECT_NEAR(firstAtomPos(pTraj2).z(), 3.0, 1e-4);

    qsys::SceneManager::getInstance()->destroyScene(pScene->getUID());
    qsys::SceneManager::getInstance()->destroyScene(pScene2->getUID());
    std::filesystem::remove_all(dir);
}

// A molecule read with a reader sub-stream (prmtop + coord) reads back from a
// .qsc saved away from the working directory: the sub-stream path is resolved
// against the scene file like the main source. Saving leaves the path in
// memory absolute, and the XML without sub-streams (the trajectory
// conversion's) reads the topology alone.
TEST(AmberPrmtopReaderTest, CoordSubStreamSurvivesQscAwayFromCwd)
{
    const std::filesystem::path dir = makeQscDir("amber_coord_qsc");
    const std::string prmtop = writeIn(dir, "water.prmtop", kPrmtopWater);
    const std::string rst = writeIn(dir, "water.rst7", kInpcrdWater);
    const std::string qsc = (dir / "water.qsc").string();

    qsys::ScenePtr pScene = qsys::SceneManager::getInstance()->createScene();
    MolCoordPtr pMol(MB_NEW MolCoord());
    {
        AmberPrmtopReader reader;
        reader.attach(pMol);
        reader.setPath(prmtop.c_str());
        reader.setPath("coord", rst.c_str());
        reader.qsys::ObjReader::read();
        reader.detach();
    }
    pScene->addObject(pMol);

    saveScene(pScene, qsc);
    EXPECT_STREQ(pMol->getSubSrcPath("coord").c_str(), rst.c_str());

    qsys::ScenePtr pScene2 = loadScene(qsc);
    ASSERT_EQ(pScene2->getObjectCount(), 1);
    MolCoordPtr pMol2(pScene2->beginObj()->second, qlib::no_throw_tag());
    ASSERT_FALSE(pMol2.isnull());
    EXPECT_NEAR(firstAtomPos(pMol2).x(), 1.0, 1e-6);
    EXPECT_NEAR(firstAtomPos(pMol2).z(), 3.0, 1e-6);
    EXPECT_STREQ(pMol2->getSubSrcPath("coord").c_str(), rst.c_str());

    auto xmlOf = [](const qlib::LByteArrayPtr &p) {
        return std::string(reinterpret_cast<const char *>(p->data()), p->size());
    };
    qsys::StreamManager *pSM = qsys::StreamManager::getInstance();
    EXPECT_NE(xmlOf(pSM->toXML2(pMol2, "Trajectory")).find("<subsrc"), std::string::npos);
    EXPECT_EQ(xmlOf(pSM->toXML2NoSubSrc(pMol2, "Trajectory")).find("<subsrc"), std::string::npos);

    qsys::SceneManager::getInstance()->destroyScene(pScene->getUID());
    qsys::SceneManager::getInstance()->destroyScene(pScene2->getUID());
    std::filesystem::remove_all(dir);
}
