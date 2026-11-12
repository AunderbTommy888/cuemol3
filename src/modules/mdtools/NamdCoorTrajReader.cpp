// -*-Mode: C++;-*-
//
// NAMD binary coordinates (.coor) read as a one-frame block
//

#include <common.h>

#include "NamdCoorTrajReader.hpp"
#include "NamdCoorFormat.hpp"
#include "Trajectory.hpp"

using namespace mdtools;

NamdCoorTrajReader::NamdCoorTrajReader() : super_t() {}

NamdCoorTrajReader::~NamdCoorTrajReader() {}

const char *NamdCoorTrajReader::getName() const
{
    return "namdcoortraj";
}

const char *NamdCoorTrajReader::getTypeDescr() const
{
    return "NAMD Coordinates (*.coor)";
}

const char *NamdCoorTrajReader::getFileExt() const
{
    return "*.coor";
}

bool NamdCoorTrajReader::read(qlib::InStream &ins)
{
    // The topology's atom count (when loaded) decides the byte order.
    int natomExpected = -1;
    TrajectoryPtr pTraj = getTargTraj();
    if (!pTraj.isnull()) natomExpected = static_cast<int>(pTraj->getAllAtomSize());

    std::vector<double> crd;
    const int natom = NamdCoorFormat::read(ins, crd, natomExpected);
    storeFrame(crd, natom, "NAMD coor");
    return true;
}

int NamdCoorTrajReader::canHandleContent(qlib::InStream &ins) const
{
    return NamdCoorFormat::sniff(ins);
}

int NamdCoorTrajReader::readFileAtomCount(qlib::InStream &ins)
{
    return NamdCoorFormat::readNatom(ins);
}
