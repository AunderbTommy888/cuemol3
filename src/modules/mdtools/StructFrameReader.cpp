// -*-Mode: C++;-*-
//
// Structure file read as a one-frame trajectory block
//

#include <common.h>

#include "StructFrameReader.hpp"
#include "TrajBlock.hpp"
#include "Trajectory.hpp"

#include <qlib/LExceptions.hpp>
#include <qsys/ObjReader.hpp>
#include <qsys/StreamManager.hpp>
#include <modules/molstr/MolCoord.hpp>
#include <modules/molstr/MolAtom.hpp>

#include <memory>
#include <vector>

using namespace mdtools;

StructFrameReader::StructFrameReader() : super_t() {}

StructFrameReader::~StructFrameReader() {}

const char *StructFrameReader::getName() const
{
    return "structframe";
}

const char *StructFrameReader::getTypeDescr() const
{
    return "Structure coordinates as one trajectory frame";
}

const char *StructFrameReader::getFileExt() const
{
    // Never picked by extension: only created for a converted molecule.
    return "*.qstructframe";
}

qsys::ObjectPtr StructFrameReader::createDefaultObj() const
{
    return qsys::ObjectPtr(MB_NEW TrajBlock());
}

bool StructFrameReader::read(qlib::InStream &ins)
{
    TrajBlockPtr pTB(getTarget<TrajBlock>());
    if (pTB.isnull()) {
        MB_THROW(qlib::RuntimeException, "StructFrameReader: not attached to a TrajBlock");
        return false;
    }

    TrajectoryPtr pTraj = getTargTraj();
    if (pTraj.isnull()) {
        MB_THROW(qlib::RuntimeException, "StructFrameReader: target Trajectory not found");
        return false;
    }

    if (m_structType.isEmpty()) {
        MB_THROW(qlib::RuntimeException, "StructFrameReader: struct_type is not set");
        return false;
    }

    // Parse the structure into a scratch molecule with the topology's reader.
    qsys::StreamManager *pSM = qsys::StreamManager::getInstance();
    std::unique_ptr<qsys::ObjReader> pRdr(pSM->createReaderPtr(m_structType));
    if (!pRdr) {
        MB_THROW(qlib::RuntimeException,
                 LString::format("StructFrameReader: reader \"%s\" not found",
                                 m_structType.c_str()));
        return false;
    }
    // Same options as the topology (e.g. PDB alt-conf loading), so the atom
    // set is the same.
    if (pTraj->getSourceType().equals(m_structType) && pTraj->getReaderOpts() != NULL)
        pRdr->readFrom2(pTraj->getReaderOpts());

    molstr::MolCoordPtr pMol(pRdr->createDefaultObj(), qlib::no_throw_tag());
    if (pMol.isnull()) {
        MB_THROW(qlib::RuntimeException,
                 LString::format("StructFrameReader: reader \"%s\" does not read a molecule",
                                 m_structType.c_str()));
        return false;
    }
    pRdr->attach(pMol);
    pRdr->read2(ins);
    pRdr->detach();

    // Coordinates in atom-ID order (the file order frames are mapped by).
    const int natomFile = pMol->getAtomSize();
    std::vector<qfloat32> filecrd;
    filecrd.reserve(static_cast<size_t>(natomFile) * 3);
    for (auto iter = pMol->beginAtom(); iter != pMol->endAtom(); ++iter) {
        const qlib::Vector4D pos = iter->second->getPos();
        filecrd.push_back(static_cast<qfloat32>(pos.x()));
        filecrd.push_back(static_cast<qfloat32>(pos.y()));
        filecrd.push_back(static_cast<qfloat32>(pos.z()));
    }

    // Validate against the topology only once it is loaded (a .qsc reads the
    // blocks before the topology; Trajectory::append() checks again then).
    const int topoN = static_cast<int>(pTraj->getAllAtomSize());
    if (topoN > 0 && natomFile != topoN) {
        MB_THROW(qlib::FileFormatException,
                 LString::format("StructFrame: Inconsistent atom count with topology %d!=%d",
                                 natomFile, topoN));
        return false;
    }

    const int loadedN = static_cast<int>(pTraj->getAtomSize());
    const int nReadAtoms = (loadedN > 0) ? loadedN : natomFile;
    pTB->allocate(nReadAtoms, 1);
    scatterCoords(pTraj, filecrd, natomFile, pTB->getCrdArray(0), 1.0f);
    pTB->setLoaded(0, true);
    return true;
}

void StructFrameReader::loadFrm(int /*ifrm*/, TrajBlock * /*pTB*/)
{
    MB_THROW(qlib::RuntimeException, "StructFrameReader: lazy frame load is not supported");
}
