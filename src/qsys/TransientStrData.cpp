// -*-Mode: C++;-*-
//
// A string value in the scene's app-data store, kept for undo/redo and not
// saved
//

#include <common.h>

#include "TransientStrData.hpp"

using namespace qsys;

TransientStrData::TransientStrData() : m_bHasValue(false)
{
  resetAllProps();
}

TransientStrData::~TransientStrData() {}
