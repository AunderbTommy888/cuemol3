// -*-Mode: C++;-*-
//
// AMBER ASCII restart (inpcrd / restrt / rst7) reader helper.
// Applies a single-snapshot coordinate set to an existing MolCoord.
//

#ifndef AMBER_CRD_READER_HPP_
#define AMBER_CRD_READER_HPP_

#include "mdtools.hpp"

#include <qlib/LString.hpp>

#include <vector>
#include <qlib/LExceptions.hpp>
#include <modules/molstr/molstr.hpp>

namespace qlib {
  class InStream;
}

namespace mdtools {

  using qlib::LString;
  using molstr::MolCoordPtr;

  ///
  ///   AMBER ASCII restart (inpcrd / restrt / rst7) helper reader.
  ///   Not an ObjReader: instantiated on the stack by AmberPrmtopReader
  ///   to apply coordinates to an already-built MolCoord.
  ///   Single snapshot only (no mdcrd / trajectory support).
  ///
  class AmberCrdReader
  {
  private:
    MolCoordPtr m_pMol;

  public:
    AmberCrdReader();
    virtual ~AmberCrdReader();

    /// Bind the target MolCoord whose atoms will receive the new positions.
    void attach(MolCoordPtr pMol);

    /// Read one snapshot from ins and overwrite m_pMol atom positions.
    void read(qlib::InStream &ins);

    /// One parsed restart snapshot.
    struct Snapshot {
      int natom = 0;
      /// Coordinates in file (atom) order, xyz interleaved, Angstrom.
      std::vector<double> crd;
      bool hasBox = false;
      /// a, b, c, alpha, beta, gamma (valid when hasBox).
      double box[6] = {0, 0, 0, 0, 0, 0};
    };

    /// Parse a whole restart file. Throws qlib::FileFormatException on a
    /// malformed or truncated file.
    static void parse(qlib::InStream &ins, Snapshot &snap);

    /// Read NATOM from the header (the first two lines) only.
    static int readNatom(qlib::InStream &ins);
  };

}

#endif
