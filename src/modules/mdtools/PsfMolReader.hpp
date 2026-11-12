// -*-Mode: C++;-*-
//
// CHARMM/NAMD/X-PLOR PSF topology reader
//

#ifndef PSF_MOL_READER_HPP_
#define PSF_MOL_READER_HPP_

#include "mdtools.hpp"

#include <qlib/mcutils.hpp>
#include <qsys/ObjReader.hpp>
#include <modules/molstr/molstr.hpp>

namespace mdtools {

using molstr::MolCoordPtr;

///
/// Reads a PSF topology as a molecule, the same way AmberPrmtopReader reads a
/// prmtop: the coordinates come from the optional "coord" sub-stream (a NAMD
/// binary .coor). Without it every atom stays at the origin -- a topology-only
/// molecule, or the topology of a Trajectory whose frames come from blocks.
///
class MDTOOLS_API PsfMolReader : public qsys::ObjReader
{
    MC_SCRIPTABLE;

    typedef qsys::ObjReader super_t;

public:
    PsfMolReader();
    ~PsfMolReader() override;

    // Bring the base-class no-argument read() back into scope.
    using super_t::read;

    bool read(qlib::InStream &ins) override;

    const char *getName() const override;
    const char *getTypeDescr() const override;
    const char *getFileExt() const override;
    qsys::ObjectPtr createDefaultObj() const override;

private:
    /// Open the "coord" sub-stream, if any, and apply it to pMol. Returns
    /// whether coordinates were applied.
    bool loadCoord(const MolCoordPtr &pMol);
};

}  // namespace mdtools

#endif
