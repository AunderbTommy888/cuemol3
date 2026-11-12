// -*-Mode: C++;-*-
//
// Base of the readers that read a one-frame coordinate file as a block
//

#include <common.h>

#include "SingleFrameTrajReader.hpp"
#include "Trajectory.hpp"

#include <qlib/LExceptions.hpp>

using namespace mdtools;

qsys::ObjectPtr SingleFrameTrajReader::createDefaultObj() const
{
    return qsys::ObjectPtr(MB_NEW TrajBlock());
}

void SingleFrameTrajReader::loadFrm(int /*ifrm*/, TrajBlock * /*pTB*/)
{
    MB_THROW(qlib::RuntimeException,
             LString::format("%s: lazy frame load is not supported", getName()));
}

void SingleFrameTrajReader::storeFrame(const std::vector<double> &crd, int natomFile,
                                       const char *fmtname)
{
    TrajBlockPtr pTB(getTarget<TrajBlock>());
    if (pTB.isnull()) {
        MB_THROW(qlib::RuntimeException,
                 LString::format("%s: not attached to a TrajBlock", fmtname));
        return;
    }

    TrajectoryPtr pTraj = getTargTraj();
    if (pTraj.isnull()) {
        MB_THROW(qlib::RuntimeException,
                 LString::format("%s: target Trajectory not found", fmtname));
        return;
    }

    // Validate against the topology only once it is loaded (a .qsc reads the
    // blocks before the topology; Trajectory::append() checks again then).
    const int topoN = static_cast<int>(pTraj->getAllAtomSize());
    if (topoN > 0 && natomFile != topoN) {
        MB_THROW(qlib::FileFormatException,
                 LString::format("%s: Inconsistent atom count with topology %d!=%d", fmtname,
                                 natomFile, topoN));
        return;
    }

    std::vector<qfloat32> filecrd(crd.begin(), crd.end());

    const int loadedN = static_cast<int>(pTraj->getAtomSize());
    const int nReadAtoms = (loadedN > 0) ? loadedN : natomFile;
    pTB->allocate(nReadAtoms, 1);
    scatterCoords(pTraj, filecrd, natomFile, pTB->getCrdArray(0), 1.0f);
    pTB->setLoaded(0, true);
}
