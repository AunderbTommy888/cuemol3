// MolCoord::toAtomNameSel: the expression it writes selects the same atoms,
// keeps insertion codes, alternate conformations and chain names differing
// by case only apart, stays one term
// per chain for a selection the same in every residue, and still means the
// same atoms after a QDF round trip renumbers them.
#include <gtest/gtest.h>
#include <common.h>
#include "molstr/MolCoord.hpp"
#include "molstr/MolAtom.hpp"
#include "molstr/AtomIterator.hpp"
#include "molstr/SelCommand.hpp"
#include "molstr/QdfMolReader.hpp"
#include "molstr/QdfMolWriter.hpp"
#include <qlib/StringStream.hpp>
#include <qsys/Scene.hpp>
#include <qsys/SceneManager.hpp>

#include <set>
#include <string>
#include <tuple>

using molstr::AtomIterator;
using molstr::MolAtom;
using molstr::MolAtomPtr;
using molstr::MolCoord;
using molstr::MolCoordPtr;
using molstr::ResidIndex;
using molstr::SelCommand;
using molstr::SelectionPtr;
using qlib::LString;

namespace {

typedef std::tuple<std::string, std::string, std::string, char> AtomKey;

void addAtom(MolCoordPtr pMol, const char *chain, ResidIndex resid, const char *name, char conf = '\0')
{
    MolAtomPtr pAtom(MB_NEW MolAtom());
    pAtom->setChainName(chain);
    pAtom->setResName("ALA");
    pAtom->setResIndex(resid);
    pAtom->setName(name);
    pAtom->setElementName(name[0] == 'H' ? "H" : "C");
    pAtom->setConfID(conf);
    pAtom->setPos(qlib::Vector4D(resid.first, 0.0, 0.0));
    pMol->appendAtom(pAtom);
}

SelectionPtr sel(const LString &expr)
{
    SelCommand *pCom = MB_NEW SelCommand();
    SelectionPtr pSel(pCom);
    EXPECT_TRUE(pCom->compile(expr)) << expr.c_str();
    return pSel;
}

/// The atoms expr selects, by chain, residue, name and conformation
std::set<AtomKey> keysOf(MolCoordPtr pMol, const LString &expr)
{
    std::set<AtomKey> keys;
    AtomIterator iter(pMol, sel(expr));
    for (iter.first(); iter.hasMore(); iter.next()) {
        MolAtomPtr a = iter.get();
        keys.emplace(a->getChainName().c_str(), a->getResIndex().toString().c_str(), a->getName().c_str(), a->getConfID());
    }
    return keys;
}

int count(const LString &s, const char *what)
{
    const std::string str(s.c_str());
    int n = 0;
    for (size_t i = str.find(what); i != std::string::npos; i = str.find(what, i + 1)) ++n;
    return n;
}

}  // namespace

TEST(AtomNameSel, SameAtomsBeforeAndAfterQdfRoundTrip)
{
    MolCoordPtr pMol(MB_NEW MolCoord());
    const ResidIndex resids[] = {ResidIndex(1), ResidIndex(2), ResidIndex(3), ResidIndex(3, 'A'),
                                 ResidIndex(4), ResidIndex(5)};
    for (const ResidIndex &r : resids) {
        addAtom(pMol, "A", r, "N");
        addAtom(pMol, "A", r, "CA");
        if (r == ResidIndex(4)) {
            addAtom(pMol, "A", r, "CB", 'A');
            addAtom(pMol, "A", r, "CB", 'B');
        }
        else {
            addAtom(pMol, "A", r, "CB");
        }
        addAtom(pMol, "A", r, "H");
    }
    addAtom(pMol, "B", ResidIndex(1), "N");
    addAtom(pMol, "B", ResidIndex(1), "CA");
    // a chain whose name differs from A by case only
    addAtom(pMol, "a", ResidIndex(1), "N");
    addAtom(pMol, "a", ResidIndex(1), "CA");
    addAtom(pMol, "a", ResidIndex(1), "H");
    // a gap in the atom IDs, which the QDF reader closes up
    ASSERT_TRUE(pMol->deleteAtoms(sel("chain A and resi 2 and name H")));

    // The same in every residue: one term each for chains A and a, chain B whole.
    const LString heavy = pMol->toAtomNameSel(sel("not name H"));
    EXPECT_EQ(count(heavy, "resi"), 2) << heavy.c_str();
    EXPECT_EQ(keysOf(pMol, heavy), keysOf(pMol, "not name H"));
    // A whole chain: not chain a with it.
    EXPECT_EQ(keysOf(pMol, pMol->toAtomNameSel(sel("chain \"A\""))), keysOf(pMol, "chain \"A\""));

    // Partly selected: an insertion-code residue, one conformation, one atom.
    const LString part = "(chain \"A\" and resi 3A) or (chain \"A\" and resi 4 and name CB and alt A) or (chain \"A\" and resi 1 and name CA)";
    const LString expr = pMol->toAtomNameSel(sel(part));
    ASSERT_FALSE(expr.isEmpty());
    EXPECT_EQ(expr.indexOf("aid"), -1) << expr.c_str();
    const std::set<AtomKey> want = keysOf(pMol, part);
    ASSERT_EQ(want.size(), 6u);
    EXPECT_EQ(keysOf(pMol, expr), want) << expr.c_str();

    // After a QDF round trip (atom IDs renumbered), the same atoms.
    molstr::QdfMolWriter writer;
    writer.attach(qsys::ObjectPtr(pMol));
    qlib::StrOutStream outs;
    ASSERT_TRUE(writer.write(outs));
    writer.detach();
    outs.close();
    int nsize = 0;
    char *pData = outs.getData(nsize);
    const std::string image(pData, size_t(nsize));
    delete[] pData;

    MolCoordPtr pMol2(MB_NEW MolCoord());
    molstr::QdfMolReader reader;
    reader.attach(qsys::ObjectPtr(pMol2));
    qlib::StrInStream ins(image.data(), int(image.size()));
    ASSERT_TRUE(reader.read(ins));
    reader.detach();
    ASSERT_EQ(pMol2->getAtomSize(), pMol->getAtomSize());
    EXPECT_EQ(keysOf(pMol2, expr), want) << expr.c_str();
    EXPECT_EQ(keysOf(pMol2, heavy), keysOf(pMol, "not name H"));
}
