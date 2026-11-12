// -*-Mode: C++;-*-
//
// AMBER ASCII restart (inpcrd / restrt / rst7) reader helper.
//

#include <common.h>

#include "AmberCrdReader.hpp"

#include <vector>

#include <qlib/LineStream.hpp>
#include <qlib/Vector4D.hpp>

#include <modules/molstr/MolCoord.hpp>
#include <modules/molstr/MolAtom.hpp>

#include <modules/symm/CrystalInfo.hpp>

using namespace mdtools;
using namespace molstr;

namespace {

// FORMAT(6F12.7): 6 values per line, 12 chars each.
constexpr int CRD_PER_LINE = 6;
constexpr int CRD_WIDTH = 12;

LString trimStr(const LString &s)
{
  return s.trim(" \t\r\n");
}

// Read all F12.7-shaped real values from the remaining stream.
void readAllReals(qlib::LineStream &lin, std::vector<double> &out)
{
  while (lin.ready()) {
    LString line = lin.readLine();
    // Strip trailing newline/CR but preserve internal width for fixed parsing.
    LString stripped = line.trim("\r\n");
    int len = static_cast<int>(stripped.length());
    int pos = 0;
    while (pos + CRD_WIDTH <= len) {
      LString tok = trimStr(stripped.substr(pos, CRD_WIDTH));
      if (tok.isEmpty()) break;
      double v = 0.0;
      if (!tok.toDouble(&v)) {
        MB_THROW(qlib::FileFormatException,
                 LString::format("Invalid real '%s' in restart trailing block", tok.c_str()));
        return;
      }
      out.push_back(v);
      pos += CRD_WIDTH;
    }
    // Tail values shorter than CRD_WIDTH (last short line) -- handle whitespace split.
    if (pos < len) {
      LString tail = trimStr(stripped.substr(pos));
      if (!tail.isEmpty()) {
        std::list<LString> tokens;
        tail.split(' ', tokens);
        for (auto &t : tokens) {
          LString tok = trimStr(t);
          if (tok.isEmpty()) continue;
          double v = 0.0;
          if (!tok.toDouble(&v)) {
            MB_THROW(qlib::FileFormatException,
                     LString::format("Invalid real '%s' in restart tail", tok.c_str()));
            return;
          }
          out.push_back(v);
        }
      }
    }
  }
}

}  // namespace

AmberCrdReader::AmberCrdReader()
{
}

AmberCrdReader::~AmberCrdReader()
{
  MB_DPRINTLN("AmberCrdReader destructed.");
}

void AmberCrdReader::attach(MolCoordPtr pMol)
{
  m_pMol = pMol;
}

namespace {

// Line 2: NATOM (TIME). Be lenient: trim and take the first whitespace token.
int readHeaderNatom(qlib::LineStream &lin)
{
  // Line 1: title (ignored).
  if (!lin.ready()) {
    MB_THROW(qlib::FileFormatException, "Empty AMBER restart file");
    return -1;
  }
  lin.readLine();

  if (!lin.ready()) {
    MB_THROW(qlib::FileFormatException, "Missing NATOM line in AMBER restart");
    return -1;
  }
  LString headerLine = trimStr(lin.readLine());
  if (headerLine.isEmpty()) {
    MB_THROW(qlib::FileFormatException, "Empty NATOM line in AMBER restart");
    return -1;
  }
  std::list<LString> headTokens;
  headerLine.split(' ', headTokens);
  int natom = -1;
  for (auto &t : headTokens) {
    LString tok = trimStr(t);
    if (tok.isEmpty()) continue;
    if (!tok.toInt(&natom)) {
      MB_THROW(qlib::FileFormatException,
               LString::format("Invalid NATOM '%s' in restart header", tok.c_str()));
      return -1;
    }
    break;
  }
  if (natom <= 0) {
    MB_THROW(qlib::FileFormatException,
             LString::format("Non-positive NATOM (%d) in restart", natom));
    return -1;
  }
  return natom;
}

}  // namespace

// static
int AmberCrdReader::readNatom(qlib::InStream &ins)
{
  qlib::LineStream lin(ins);
  return readHeaderNatom(lin);
}

// static
void AmberCrdReader::parse(qlib::InStream &ins, Snapshot &snap)
{
  qlib::LineStream lin(ins);
  const int natom = readHeaderNatom(lin);

  // Read all remaining reals (coords + optional velocities + optional box).
  std::vector<double> reals;
  reals.reserve(3 * natom + 6);
  readAllReals(lin, reals);

  const int nCoord = 3 * natom;
  if (static_cast<int>(reals.size()) < nCoord) {
    MB_THROW(qlib::FileFormatException,
             LString::format("AMBER restart truncated: expected at least %d reals, got %d",
                             nCoord, static_cast<int>(reals.size())));
    return;
  }

  // Detect optional trailing blocks.
  const int nExtra = static_cast<int>(reals.size()) - nCoord;
  bool hasVel = false;
  bool hasBox = false;
  if (nExtra == 0) {
    // Coordinates only.
  } else if (nExtra == nCoord) {
    hasVel = true;
  } else if (nExtra == 6) {
    hasBox = true;
  } else if (nExtra == nCoord + 6) {
    hasVel = true;
    hasBox = true;
  } else {
    LOG_DPRINTLN("AmberCrdReader> Warning: %d trailing values do not match "
                 "any known restart layout (coords-only/+vel/+box/+vel+box); "
                 "extras ignored", nExtra);
  }

  snap.natom = natom;
  snap.crd.assign(reals.begin(), reals.begin() + nCoord);
  snap.hasBox = hasBox;
  if (hasBox) {
    const int boxOffset = nCoord + (hasVel ? nCoord : 0);
    for (int i = 0; i < 6; ++i) snap.box[i] = reals[boxOffset + i];
  }
}

void AmberCrdReader::read(qlib::InStream &ins)
{
  Snapshot snap;
  parse(ins, snap);
  const int natom = snap.natom;

  // Verify NATOM matches the attached MolCoord.
  if (m_pMol->getAtomSize() != natom) {
    LString msg = LString::format(
        "AMBER restart NATOM (%d) does not match prmtop NATOM (%d)",
        natom, m_pMol->getAtomSize());
    MB_THROW(qlib::FileFormatException, msg);
    return;
  }

  // Apply coordinates to existing atoms. AID assignment in AmberPrmtopReader
  // is strictly sequential (i -> AID i), matching prmtop convention.
  qlib::Vector4D pos;
  for (int i = 0; i < natom; ++i) {
    MolAtomPtr pAtom = m_pMol->getAtom(i);
    qlib::ensureNotNull(pAtom);
    pos.x() = snap.crd[i * 3 + 0];
    pos.y() = snap.crd[i * 3 + 1];
    pos.z() = snap.crd[i * 3 + 2];
    pAtom->setPos(pos);
  }

  if (snap.hasBox) {
    symm::CrystalInfoPtr pci = m_pMol->getCreateExtData("CrystalInfo");
    if (pci.isnull()) {
      LOG_DPRINTLN("AmberCrdReader> Warning: failed to attach CrystalInfo");
    } else {
      pci->setCellDimension(snap.box[0], snap.box[1], snap.box[2],
                            snap.box[3], snap.box[4], snap.box[5]);
    }
  }

  LOG_DPRINTLN("AmberCrdReader> applied coords to %d atoms (box=%d)",
               natom, snap.hasBox ? 1 : 0);
}
