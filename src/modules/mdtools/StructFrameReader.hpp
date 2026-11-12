// -*-Mode: C++;-*-
//
// Structure file read as a one-frame trajectory block
//

#ifndef STRUCT_FRAME_READER_HPP_
#define STRUCT_FRAME_READER_HPP_

#include "mdtools.hpp"

#include <qlib/mcutils.hpp>

#include "TrajBlock.hpp"

namespace mdtools {

///
/// Reads a structure file (PDB, GRO, ...) as a trajectory block of one frame.
///
/// A molecule converted to a Trajectory keeps its own coordinates as frame 0
/// through this block: the block references the molecule's file, so a .qsc
/// stores it like any other trajectory file and reads it back the same way.
/// The structure is parsed with the molecule reader named by struct_type (the
/// one the topology was read with, and with the topology's reader options
/// when the trajectory was read by that same reader), so the atom count and
/// order match the topology. Coordinates are taken in atom-ID order, which is
/// the file order the trajectory maps frames by, and are already in Angstrom.
///
class MDTOOLS_API StructFrameReader : public TrajBlockReader
{
    MC_SCRIPTABLE;

    typedef TrajBlockReader super_t;

public:
    StructFrameReader();
    virtual ~StructFrameReader();

    virtual const char *getName() const override;
    virtual const char *getTypeDescr() const override;
    virtual const char *getFileExt() const override;

    /// The reader's default object is a TrajBlock (appended to a Trajectory).
    virtual qsys::ObjectPtr createDefaultObj() const override;

    virtual bool read(qlib::InStream &ins) override;

    /// Never called: the single frame is always read eagerly.
    virtual void loadFrm(int ifrm, TrajBlock *pTB) override;

private:
    LString m_structType;

public:
    const LString &getStructType() const { return m_structType; }
    void setStructType(const LString &s) { m_structType = s; }
};

}  // namespace mdtools

#endif
