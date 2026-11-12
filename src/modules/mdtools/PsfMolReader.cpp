// -*-Mode: C++;-*-
//
// CHARMM/NAMD/X-PLOR PSF topology reader
//

#include <common.h>

#include "PsfMolReader.hpp"
#include "PsfReader.hpp"
#include "NamdCoorFormat.hpp"

#include <memory>
#include <vector>

#include <qlib/Vector4D.hpp>
#include <modules/molstr/MolCoord.hpp>
#include <modules/molstr/MolAtom.hpp>

using namespace mdtools;
using namespace molstr;

PsfMolReader::PsfMolReader() : super_t() {}

PsfMolReader::~PsfMolReader() {}

const char *PsfMolReader::getName() const
{
    return "psf";
}

const char *PsfMolReader::getTypeDescr() const
{
    return "CHARMM/NAMD PSF Topology (*.psf)";
}

const char *PsfMolReader::getFileExt() const
{
    return "*.psf";
}

qsys::ObjectPtr PsfMolReader::createDefaultObj() const
{
    return qsys::ObjectPtr(MB_NEW MolCoord());
}

bool PsfMolReader::read(qlib::InStream &ins)
{
    MolCoordPtr pMol(getTarget<MolCoord>());

    PsfReader psf;
    psf.attach(pMol);
    psf.read(ins);

    const bool bHasCoord = loadCoord(pMol);

    pMol->applyTopology();
    // Secondary structure is geometry-based; a topology-only load leaves it to
    // the Trajectory, which recomputes it on frame 0.
    if (bHasCoord) pMol->calcProt2ndry();

    LOG_DPRINTLN("PsfMolReader> read %d atoms (coord=%d)", pMol->getAtomSize(), bHasCoord ? 1 : 0);
    return true;
}

bool PsfMolReader::loadCoord(const MolCoordPtr &pMol)
{
    if (getPath(LString("coord")).isEmpty()) {
        LOG_DPRINTLN("PsfMolReader> no coord sub-stream: atom positions are undefined (zero).");
        return false;
    }

    std::unique_ptr<qlib::InStream> pSubIn(createInStream("coord"));
    qlib::ensureNotNull(pSubIn.get());

    std::vector<double> crd;
    const int natom = NamdCoorFormat::read(*pSubIn, crd, pMol->getAtomSize());

    // PsfReader assigns atom IDs in file order (i -> AID i).
    qlib::Vector4D pos;
    for (int i = 0; i < natom; ++i) {
        MolAtomPtr pAtom = pMol->getAtom(i);
        qlib::ensureNotNull(pAtom);
        pos.x() = crd[i * 3 + 0];
        pos.y() = crd[i * 3 + 1];
        pos.z() = crd[i * 3 + 2];
        pAtom->setPos(pos);
    }
    return true;
}
