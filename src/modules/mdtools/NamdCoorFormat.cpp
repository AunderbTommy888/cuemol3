// -*-Mode: C++;-*-
//
// NAMD binary coordinate (.coor) file format helpers
//

#include <common.h>

#include "NamdCoorFormat.hpp"

#include <cmath>
#include <cstring>

#include <qlib/BinStream.hpp>
#include <qlib/LExceptions.hpp>
#include <qlib/LString.hpp>
#include <qsys/ObjReader.hpp>

using namespace mdtools;
using qlib::LString;

namespace {

constexpr qint32 MAX_NATOMS = 10000000;  // 1e7 atoms -- upper bound for realistic MD systems
constexpr qfloat64 SNIFF_COORD_MAX = 10000.0;  // Angstrom -- normal MD coords stay well within this range

bool plausibleNatom(qint32 n)
{
    return n >= 1 && n <= MAX_NATOMS;
}

qint32 swapped(qint32 n)
{
    qlib::LByteSwapper<qint32>::swap(n);
    return n;
}

}  // namespace

int NamdCoorFormat::readNatom(qlib::InStream &ins)
{
    char buf[4];
    int total = 0;
    while (total < 4) {
        int n = ins.read(buf, total, 4 - total);
        if (n <= 0) break;
        total += n;
    }
    if (total < 4) return -1;
    qint32 natoms;
    std::memcpy(&natoms, buf, sizeof(qint32));
    if (plausibleNatom(natoms)) return natoms;
    if (plausibleNatom(swapped(natoms))) return swapped(natoms);
    return -1;
}

int NamdCoorFormat::read(qlib::InStream &ins, std::vector<double> &crd, int natomExpected)
{
    qlib::BinInStream bins(ins);

    const qint32 raw = bins.tread<qint32>();
    qint32 natoms = raw;
    bool bSwap = false;
    if (natomExpected > 0) {
        if (raw != natomExpected) {
            if (swapped(raw) != natomExpected) {
                MB_THROW(qlib::FileFormatException,
                         LString::format("NAMD coor: atom count %d (or %d) does not match %d", raw,
                                         swapped(raw), natomExpected));
                return -1;
            }
            bSwap = true;
        }
    }
    else if (!plausibleNatom(raw)) {
        if (!plausibleNatom(swapped(raw))) {
            MB_THROW(qlib::FileFormatException,
                     LString::format("NAMD coor: invalid atom count %d", raw));
            return -1;
        }
        bSwap = true;
    }
    if (bSwap) {
        natoms = swapped(raw);
        LOG_DPRINTLN("NAMDCoor> Input is byte-swapped!!");
        bins.setSwapMode(qlib::BinInStream::MODE_SWAP);
    }

    crd.resize(static_cast<size_t>(natoms) * 3);
    for (size_t i = 0; i < crd.size(); ++i) crd[i] = bins.tread<qfloat64>();
    return natoms;
}

/// Each coordinate must also be zero or a normal double. Two small int32
/// words read as one float64 always give a subnormal value, so this rejects
/// binary headers made of small integers (e.g. the CCP4/MRC NC, NR, NS, MODE
/// words), which would otherwise pass as coordinates close to zero.
int NamdCoorFormat::sniff(qlib::InStream &ins)
{
    constexpr int HEADER_SIZE = 4 + 3 * 8;  // int32 natoms + 3 * float64 xyz
    char buf[HEADER_SIZE];
    int total = 0;
    while (total < HEADER_SIZE) {
        int n = ins.read(buf, total, HEADER_SIZE - total);
        if (n <= 0) break;
        total += n;
    }
    if (total < HEADER_SIZE) return qsys::ObjReader::CONTENT_UNKNOWN;

    auto coordLike = [](qfloat64 v) -> bool { return v == 0.0 || std::fpclassify(v) == FP_NORMAL; };
    auto plausible = [&coordLike](qint32 natoms, qfloat64 x, qfloat64 y, qfloat64 z) -> bool {
        if (!plausibleNatom(natoms)) return false;
        if (!coordLike(x) || !coordLike(y) || !coordLike(z)) return false;
        if (std::abs(x) > SNIFF_COORD_MAX) return false;
        if (std::abs(y) > SNIFF_COORD_MAX) return false;
        if (std::abs(z) > SNIFF_COORD_MAX) return false;
        return true;
    };

    qint32 natoms;
    qfloat64 x, y, z;
    std::memcpy(&natoms, buf + 0, sizeof(qint32));
    std::memcpy(&x, buf + 4, sizeof(qfloat64));
    std::memcpy(&y, buf + 12, sizeof(qfloat64));
    std::memcpy(&z, buf + 20, sizeof(qfloat64));
    if (plausible(natoms, x, y, z)) return qsys::ObjReader::CONTENT_YES;

    qlib::LByteSwapper<qint32>::swap(natoms);
    qlib::LByteSwapper<qfloat64>::swap(x);
    qlib::LByteSwapper<qfloat64>::swap(y);
    qlib::LByteSwapper<qfloat64>::swap(z);
    if (plausible(natoms, x, y, z)) return qsys::ObjReader::CONTENT_YES;

    return qsys::ObjReader::CONTENT_UNKNOWN;
}
