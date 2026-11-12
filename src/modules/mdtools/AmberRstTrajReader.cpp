// -*-Mode: C++;-*-
//
// AMBER ASCII restart (inpcrd / rst7 / restrt) read as a one-frame block
//

#include <common.h>

#include "AmberRstTrajReader.hpp"
#include "AmberCrdReader.hpp"

using namespace mdtools;

AmberRstTrajReader::AmberRstTrajReader() : super_t() {}

AmberRstTrajReader::~AmberRstTrajReader() {}

const char *AmberRstTrajReader::getName() const
{
    return "amberrst";
}

const char *AmberRstTrajReader::getTypeDescr() const
{
    return "AMBER Restart (*.rst7;*.inpcrd;*.restrt)";
}

const char *AmberRstTrajReader::getFileExt() const
{
    return "*.rst7;*.inpcrd;*.restrt";
}

bool AmberRstTrajReader::read(qlib::InStream &ins)
{
    AmberCrdReader::Snapshot snap;
    AmberCrdReader::parse(ins, snap);
    storeFrame(snap.crd, snap.natom, "AMBER restart");
    return true;
}

int AmberRstTrajReader::readFileAtomCount(qlib::InStream &ins)
{
    return AmberCrdReader::readNatom(ins);
}
