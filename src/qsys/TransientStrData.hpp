// -*-Mode: C++;-*-
//
// A string value in the scene's app-data store, kept for undo/redo and not
// saved
//

#ifndef QSYS_TRANSIENT_STR_DATA_HPP_INCLUDED
#define QSYS_TRANSIENT_STR_DATA_HPP_INCLUDED

#include "qsys.hpp"
#include "SceneAppData.hpp"

#include <qlib/mcutils.hpp>

class TransientStrData_wrap;

namespace qsys {

  /// A generic key/value entry of the app-data store (the key is the app-data
  /// id). Writes are undoable edits like any other property of app data;
  /// the entry is never written to the scene file. A client deletes a value
  /// by writing has_value = false, never by removing the entry, since the
  /// undo history refers to the entry by its UID.
  class QSYS_API TransientStrData : public SceneAppData
  {
    MC_SCRIPTABLE;

    friend class ::TransientStrData_wrap;

  private:
    LString m_value;
    bool m_bHasValue;

  public:
    TransientStrData();
    ~TransientStrData() override;

    bool isPersistent() const override { return false; }
  };

}

#endif
