// -*-Mode: C++;-*-
//
// Object / Renderer loading/unloading edit info
//

#ifndef QSYS_OBJLOAD_EDIT_INFO_HPP_INCLUDED
#define QSYS_OBJLOAD_EDIT_INFO_HPP_INCLUDED

#include "qsys.hpp"

#include "EditInfo.hpp"
#include <qlib/LVariant.hpp>
#include <qlib/ObjectManager.hpp>

namespace qsys {

  ///
  /// Object / Renderer loading/unloading edit info
  ///
  class ObjLoadEditInfo : public EditInfo
  {
  private:
    qlib::uid_t m_nSceneID;
    ObjectPtr m_pTgtObj;

    qlib::uid_t m_nObjID;
    RendererPtr m_pTgtRend;

    /// Renderers the created object carried when its creation was undone.
    /// Scene::destroyObject() strips them without recording (undo is in
    /// progress), so redo re-attaches them from here. Empty for an object
    /// whose renderers were created after it joined the scene: those are
    /// recorded on their own and already gone when the creation is undone.
    std::vector<RendererPtr> m_stashRends;

    enum {
      OLEI_OBJ_CREATE,
      OLEI_OBJ_DESTROY,
      OLEI_REND_CREATE,
      OLEI_REND_DESTROY
    };

    int m_nMode;

  public:

    ObjLoadEditInfo();
    ~ObjLoadEditInfo() override;

    void setupObjCreate(qlib::uid_t scid, ObjectPtr pObj);

    void setupObjDestroy(qlib::uid_t scid, ObjectPtr pObj);

    void setupRendCreate(qlib::uid_t objid, RendererPtr pRend);

    void setupRendDestroy(qlib::uid_t objid, RendererPtr pRend);

    /** perform undo */
    bool undo() override;

    /** perform redo */
    bool redo() override;

    bool isUndoable() const override;

    bool isRedoable() const override;

  };

}

#endif
