// -*-Mode: C++;-*-
//
// NAMD binary coordinates (.coor) read as a one-frame block
//

#ifndef NAMD_COOR_TRAJ_READER_HPP_
#define NAMD_COOR_TRAJ_READER_HPP_

#include "mdtools.hpp"

#include <qlib/mcutils.hpp>

#include "SingleFrameTrajReader.hpp"

namespace mdtools {

///
/// Reads a NAMD binary .coor file as a trajectory block of one frame, so a
/// topology-only PSF (or any topology with the same atom order) gets its
/// coordinates the same way it gets a DCD.
///
class MDTOOLS_API NamdCoorTrajReader : public SingleFrameTrajReader
{
    MC_SCRIPTABLE;

    typedef SingleFrameTrajReader super_t;

public:
    NamdCoorTrajReader();
    virtual ~NamdCoorTrajReader();

    virtual const char *getName() const override;
    virtual const char *getTypeDescr() const override;
    virtual const char *getFileExt() const override;

    virtual bool read(qlib::InStream &ins) override;

    /// NAMD coor has no magic; see NamdCoorFormat::sniff().
    virtual int canHandleContent(qlib::InStream &ins) const override;

protected:
    virtual int readFileAtomCount(qlib::InStream &ins) override;
};

}  // namespace mdtools

#endif
