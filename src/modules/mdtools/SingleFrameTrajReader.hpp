// -*-Mode: C++;-*-
//
// Base of the readers that read a one-frame coordinate file as a block
//

#ifndef SINGLE_FRAME_TRAJ_READER_HPP_
#define SINGLE_FRAME_TRAJ_READER_HPP_

#include "mdtools.hpp"

#include <vector>

#include "TrajBlock.hpp"

namespace mdtools {

///
/// A coordinate file holding one frame and no topology (AMBER restart, NAMD
/// .coor), read as a trajectory block of one frame. The frame is always read
/// eagerly: there is nothing to defer.
///
class MDTOOLS_API SingleFrameTrajReader : public TrajBlockReader
{
    typedef TrajBlockReader super_t;

public:
    SingleFrameTrajReader() : super_t() {}

    /// The reader's default object is a TrajBlock (appended to a Trajectory).
    virtual qsys::ObjectPtr createDefaultObj() const override;

    /// Never called: the single frame is always read eagerly.
    virtual void loadFrm(int ifrm, TrajBlock *pTB) override;

protected:
    /// Store the file-order coordinates (xyz interleaved, Angstrom, natomFile
    /// atoms) as the attached block's only frame, after checking the atom
    /// count against the topology once it is loaded.
    void storeFrame(const std::vector<double> &crd, int natomFile, const char *fmtname);
};

}  // namespace mdtools

#endif
