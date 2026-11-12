// -*-Mode: C++;-*-
//
// AMBER ASCII restart (inpcrd / rst7 / restrt) read as a one-frame block
//

#ifndef AMBER_RST_TRAJ_READER_HPP_
#define AMBER_RST_TRAJ_READER_HPP_

#include "mdtools.hpp"

#include <qlib/mcutils.hpp>

#include "SingleFrameTrajReader.hpp"

namespace mdtools {

///
/// Reads an AMBER ASCII restart as a trajectory block of one frame, so a
/// topology-only prmtop (or any topology with the same atom order) gets its
/// coordinates the same way it gets a trajectory. The box and velocities are
/// not read.
///
class MDTOOLS_API AmberRstTrajReader : public SingleFrameTrajReader
{
    MC_SCRIPTABLE;

    typedef SingleFrameTrajReader super_t;

public:
    AmberRstTrajReader();
    virtual ~AmberRstTrajReader();

    virtual const char *getName() const override;
    virtual const char *getTypeDescr() const override;
    virtual const char *getFileExt() const override;

    virtual bool read(qlib::InStream &ins) override;

protected:
    virtual int readFileAtomCount(qlib::InStream &ins) override;
};

}  // namespace mdtools

#endif
