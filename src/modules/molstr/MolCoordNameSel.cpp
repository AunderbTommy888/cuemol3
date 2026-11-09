// -*-Mode: C++;-*-
//
// MolCoord::toAtomNameSel: a set of atoms as a selection expression without
// atom IDs
//

#include <common.h>

#include "MolCoord.hpp"
#include "MolChain.hpp"
#include "MolResidue.hpp"
#include "MolAtom.hpp"
#include "AtomIterator.hpp"
#include "SelCommand.hpp"

#include <set>
#include <vector>

using namespace molstr;
using qlib::LString;

namespace {

typedef std::set<LString> NameSet;

/// Whether a name can be written bare: a selection token that is no keyword
/// (keywords are lower case, so a name with no lower-case letter is safe).
bool isBareName(const LString &s)
{
  if (s.isEmpty()) return false;
  for (int i = 0; i < s.length(); ++i) {
    const char c = s.getAt(i);
    const bool ok = (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' ||
                    (i > 0 && c == '\'');
    if (!ok) return false;
  }
  // a bare number would read as a number, not a name
  const char c0 = s.getAt(0);
  if (c0 >= '0' && c0 <= '9') {
    bool allDigits = true;
    for (int i = 0; i < s.length(); ++i)
      if (s.getAt(i) < '0' || s.getAt(i) > '9') allDigits = false;
    if (allDigits) return false;
  }
  return true;
}

LString quoteName(const LString &s)
{
  if (isBareName(s)) return s;
  LString r = "\"";
  for (int i = 0; i < s.length(); ++i) {
    const char c = s.getAt(i);
    if (c == '"' || c == '\\') r += '\\';
    r += c;
  }
  return r + "\"";
}

LString nameList(const NameSet &names)
{
  LString r;
  for (const LString &n : names) {
    if (!r.isEmpty()) r += ",";
    r += quoteName(n);
  }
  return r;
}

/// One residue: which of its atoms are selected
struct ResidSel
{
  ResidIndex index;
  /// selected / unselected atom names (meaningful when !partialAlt)
  NameSet sel, unsel;
  /// some name has both selected and unselected conformations
  bool partialAlt = false;
  /// the selected atoms by name and conformation (for partialAlt)
  std::vector<std::pair<LString, char>> atoms;
  /// every conformation of each name (for partialAlt)
  std::map<LString, std::set<char>> confs;
};

bool disjoint(const NameSet &a, const NameSet &b)
{
  for (const LString &n : a)
    if (b.count(n)) return false;
  return true;
}

/// The term selecting the selected atoms of one residue whose alternate
/// conformations are only partly selected.
LString altTerm(const ResidSel &r)
{
  std::map<LString, std::set<char>> picked;
  for (const auto &a : r.atoms) picked[a.first].insert(a.second);
  LString out;
  for (const auto &p : picked) {
    const std::set<char> &all = r.confs.at(p.first);
    LString t;
    if (p.second == all) {
      t = "name " + quoteName(p.first);
    }
    else {
      for (char c : p.second) {
        LString one;
        if (c != '\0') {
          one = "(name " + quoteName(p.first) + " and alt " + quoteName(LString(c)) + ")";
        }
        else {
          // the atom without a conformation ID: not any of the others
          NameSet others;
          for (char o : all)
            if (o != '\0') others.insert(LString(o));
          one = "(name " + quoteName(p.first) + " and not alt " + nameList(others) + ")";
        }
        t += t.isEmpty() ? one : " or " + one;
      }
    }
    out += out.isEmpty() ? t : " or " + t;
  }
  return out;
}

/// The residue part of a run: a range, or a list of every residue
LString residPart(const std::vector<const ResidSel *> &run, bool ranges)
{
  if (ranges) {
    const LString a = run.front()->index.toString();
    const LString b = run.back()->index.toString();
    return run.size() == 1 ? "resi " + a : "resi " + a + ":" + b;
  }
  LString r;
  for (const ResidSel *p : run) {
    if (!r.isEmpty()) r += ",";
    r += p->index.toString();
  }
  return "resi " + r;
}

LString runTerm(const std::vector<const ResidSel *> &run, bool ranges)
{
  NameSet s, u;
  for (const ResidSel *p : run) {
    s.insert(p->sel.begin(), p->sel.end());
    u.insert(p->unsel.begin(), p->unsel.end());
  }
  const LString resi = residPart(run, ranges);
  if (u.empty()) return "(" + resi + ")";
  const LString inc = "name " + nameList(s);
  const LString exc = "not name " + nameList(u);
  return "(" + resi + " and " + (exc.length() < inc.length() ? exc : inc) + ")";
}

std::set<int> atomsOf(MolCoordPtr pMol, SelectionPtr pSel)
{
  std::set<int> ids;
  AtomIterator iter(pMol, pSel);
  for (iter.first(); iter.hasMore(); iter.next()) ids.insert(iter.getID());
  return ids;
}

/// The expression for the atoms `ids` of the molecule.
LString buildExpr(const MolCoord &mol, const std::set<int> &ids, bool ranges)
{
  if (ids.empty()) return "none";
  if (static_cast<int>(ids.size()) == mol.getAtomSize()) return "*";

  LString out;
  for (MolCoord::ChainIter ci = mol.begin(); ci != mol.end(); ++ci) {
    MolChainPtr pCh = ci->second;
    std::vector<ResidSel> resids;
    int nAll = 0, nSel = 0;
    for (MolChain::ResidCursor2 ri = pCh->begin2(); ri != pCh->end2(); ++ri) {
      MolResiduePtr pRes = ri->second;
      ResidSel r;
      r.index = pRes->getIndex();
      NameSet selNames, unselNames;
      for (MolResidue::AtomCursor ai = pRes->atomBegin(); ai != pRes->atomEnd(); ++ai) {
        MolAtomPtr pAtom = mol.getAtom(ai->second);
        if (pAtom.isnull()) continue;
        const LString &name = pAtom->getName();
        const char conf = pAtom->getConfID();
        r.confs[name].insert(conf);
        ++nAll;
        if (ids.count(ai->second)) {
          ++nSel;
          selNames.insert(name);
          r.atoms.emplace_back(name, conf);
        }
        else {
          unselNames.insert(name);
        }
      }
      r.partialAlt = !disjoint(selNames, unselNames);
      r.sel = selNames;
      r.unsel = unselNames;
      resids.push_back(r);
    }
    if (nSel == 0) continue;

    const LString chain = "chain " + quoteName(pCh->getName());
    LString body;
    if (nSel != nAll) {
      // Runs of residues next to each other (in residue order, so a range
      // covers exactly the run) whose selected and unselected names do not
      // meet: one name filter then picks the selected atoms in each of them.
      std::vector<LString> terms;
      std::vector<const ResidSel *> run;
      NameSet runSel, runUnsel;
      auto flush = [&]() {
        if (!run.empty()) terms.push_back(runTerm(run, ranges));
        run.clear();
        runSel.clear();
        runUnsel.clear();
      };
      for (const ResidSel &r : resids) {
        if (r.sel.empty()) {
          flush();
          continue;
        }
        if (r.partialAlt) {
          flush();
          terms.push_back("(resi " + r.index.toString() + " and (" + altTerm(r) + "))");
          continue;
        }
        NameSet s = runSel, u = runUnsel;
        s.insert(r.sel.begin(), r.sel.end());
        u.insert(r.unsel.begin(), r.unsel.end());
        if (!disjoint(s, u)) {
          flush();
          s = r.sel;
          u = r.unsel;
        }
        run.push_back(&r);
        runSel = s;
        runUnsel = u;
      }
      flush();
      for (const LString &t : terms) body += body.isEmpty() ? t : " or " + t;
    }
    const LString term = body.isEmpty() ? chain : "(" + chain + " and (" + body + "))";
    out += out.isEmpty() ? term : " or " + term;
  }
  return out;
}

}  // namespace

LString MolCoord::toAtomNameSel(SelectionPtr psel) const
{
  MolCoordPtr pthis(const_cast<MolCoord *>(this));
  const std::set<int> ids = atomsOf(pthis, psel);

  // Ranges first; a list of every residue if the ranges do not give the same
  // atoms back (they should: a run is next-to-each-other in residue order).
  for (bool ranges : {true, false}) {
    const LString expr = buildExpr(*this, ids, ranges);
    SelCommand *pCom = MB_NEW SelCommand();
    SelectionPtr pSel(pCom);
    if (pCom->compile(expr, getSceneID()) && atomsOf(pthis, pSel) == ids) return expr;
    LOG_DPRINTLN("MolCoord> toAtomNameSel: \"%s\" does not give the same atoms", expr.c_str());
  }
  return LString();
}
