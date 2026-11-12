// -*-Mode: C++;-*-
//
// NAMD binary coordinate (.coor) file format helpers
//

#ifndef NAMD_COOR_FORMAT_HPP_
#define NAMD_COOR_FORMAT_HPP_

#include "mdtools.hpp"

#include <vector>

namespace qlib {
class InStream;
}

namespace mdtools {

///
/// NAMD binary coordinates: int32 natoms followed by natoms * 3 float64
/// (x, y, z per atom, Angstrom), in the byte order of the machine that wrote
/// it. There is no magic number, so the byte order is told by the atom count.
///
class NamdCoorFormat
{
public:
    /// Read the whole file into crd (xyz interleaved, file atom order) and
    /// return the atom count. When natomExpected > 0 the byte order is the one
    /// that gives that count (and a file that gives neither throws); otherwise
    /// it is the one that gives a plausible count. Throws
    /// qlib::FileFormatException on a malformed or truncated file.
    static int read(qlib::InStream &ins, std::vector<double> &crd, int natomExpected = -1);

    /// Read the atom count from the header only, or -1 when it is not plausible
    /// in either byte order.
    static int readNatom(qlib::InStream &ins);

    /// Content sniff (ObjReader::canHandleContent): the atom count and the
    /// first atom's coordinates look plausible in either byte order.
    static int sniff(qlib::InStream &ins);
};

}  // namespace mdtools

#endif
