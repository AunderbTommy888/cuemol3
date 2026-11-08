// -*-Mode: C++;-*-
//
// Tests for the map kind (DensityMap::map_type) and the display region
// policy (MapRenderer::region_mode) resolution, and the periodic-boundary
// eligibility that combines them with use_pbc.
//

#include <gtest/gtest.h>
#include <common.h>
#include <qlib/Vector4D.hpp>
#include <qsys/Scene.hpp>
#include <qsys/SceneManager.hpp>
#include <qsys/style/StyleFile.hpp>
#include <qsys/style/StyleMgr.hpp>
#include <vector>
#include "xtal/DensityMap.hpp"
#include "xtal/MapRenderer.hpp"
#include "xtal/MapSurfRenderer.hpp"
#include "molstr/MolCoord.hpp"
#include <qsys/TTYView.hpp>
#include <cstdio>

using qlib::Vector4D;
using xtal::DensityMap;
using xtal::MapRenderer;
using xtal::MapSurfRenderer;

namespace {

class MapRegionTest : public ::testing::Test {
protected:
    qsys::ScenePtr m_pScene;
    qsys::ObjectPtr m_pObj;
    qsys::RendererPtr m_pRend;
    DensityMap *m_pMap;
    MapSurfRenderer *m_pMSR;

    void SetUp() override
    {
        m_pScene = qsys::SceneManager::getInstance()->createScene();

        const int n = 4;
        m_pMap = MB_NEW DensityMap();
        std::vector<float> data((size_t)n * n * n);
        for (size_t i = 0; i < data.size(); ++i)
            data[i] = float(i % 7) - 3.0f;
        m_pMap->setMapFloatArray(data.data(), n, n, n, 0, 1, 2);
        m_pMap->setMapParams(0, 0, 0, n, n, n);
        m_pMap->setXtalParams(double(n), double(n), double(n), 90.0, 90.0, 90.0);

        m_pObj = qsys::ObjectPtr(m_pMap);
        m_pObj->setName("regmap");
        m_pScene->addObject(m_pObj);

        m_pRend = m_pObj->createRenderer("isosurf");
        m_pMSR = dynamic_cast<MapSurfRenderer *>(m_pRend.get());
        ASSERT_NE(m_pMSR, nullptr);
    }

    void TearDown() override
    {
        qsys::SceneManager::getInstance()->destroyScene(m_pScene->getUID());
    }
};

}  // namespace

// A map without reader evidence is crystallographic: periodic, and the
// renderer keeps the historical box region (the crystal user's default).
TEST_F(MapRegionTest, DefaultIsXtalAndBox)
{
    EXPECT_EQ(m_pMap->getMapType(), DensityMap::MAPTYPE_AUTO);
    EXPECT_EQ(m_pMap->getEffectiveMapType(), DensityMap::MAPTYPE_XTAL);
    EXPECT_TRUE(m_pMap->isPeriodic());
    EXPECT_EQ(std::string(m_pMap->getMapTypeResolvedStr().c_str()), "xtal");

    EXPECT_EQ(m_pMSR->getRegionMode(), MapRenderer::REGION_AUTO);
    EXPECT_EQ(m_pMSR->getEffectiveRegionMode(), MapRenderer::REGION_BOX);
    EXPECT_EQ(std::string(m_pMSR->getRegionModeResolvedStr().c_str()), "box");
}

// The reader's EM detection flips the auto region policy to full.
TEST_F(MapRegionTest, DetectedEMResolvesToFull)
{
    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_EM);

    EXPECT_EQ(m_pMap->getMapType(), DensityMap::MAPTYPE_AUTO);
    EXPECT_EQ(m_pMap->getEffectiveMapType(), DensityMap::MAPTYPE_EM);
    EXPECT_FALSE(m_pMap->isPeriodic());
    EXPECT_EQ(std::string(m_pMap->getMapTypeResolvedStr().c_str()), "em");
    EXPECT_EQ(m_pMSR->getEffectiveRegionMode(), MapRenderer::REGION_FULL);
    EXPECT_EQ(std::string(m_pMSR->getRegionModeResolvedStr().c_str()), "full");
}

// An explicit map_type overrides the detection in both directions.
TEST_F(MapRegionTest, MapTypeOverridesDetection)
{
    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_EM);
    m_pMap->setMapType(DensityMap::MAPTYPE_XTAL);
    EXPECT_TRUE(m_pMap->isPeriodic());
    EXPECT_EQ(m_pMSR->getEffectiveRegionMode(), MapRenderer::REGION_BOX);

    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_XTAL);
    m_pMap->setMapType(DensityMap::MAPTYPE_EM);
    EXPECT_FALSE(m_pMap->isPeriodic());
    EXPECT_EQ(m_pMSR->getEffectiveRegionMode(), MapRenderer::REGION_FULL);
}

// The renderer forwards the object's effective map kind so the GUI can show
// it without reaching for the parent object, and follows both the reader's
// detection and an explicit override.
TEST_F(MapRegionTest, RendererForwardsTheResolvedMapKind)
{
    EXPECT_EQ(std::string(m_pMSR->getMapTypeResolvedStr().c_str()), "xtal");

    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_EM);
    EXPECT_EQ(std::string(m_pMSR->getMapTypeResolvedStr().c_str()), "em");

    m_pMap->setMapType(DensityMap::MAPTYPE_XTAL);
    EXPECT_EQ(std::string(m_pMSR->getMapTypeResolvedStr().c_str()), "xtal");
}

// An explicit region_mode overrides the map kind on the renderer side, so
// a crystallographic map can be shown in full and an EM map in a box.
TEST_F(MapRegionTest, RegionModeOverridesMapKind)
{
    m_pMSR->setRegionMode(MapRenderer::REGION_FULL);
    EXPECT_EQ(m_pMSR->getEffectiveRegionMode(), MapRenderer::REGION_FULL);

    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_EM);
    m_pMSR->setRegionMode(MapRenderer::REGION_BOX);
    EXPECT_EQ(m_pMSR->getEffectiveRegionMode(), MapRenderer::REGION_BOX);
}

// PBC needs all of: a periodic map, a block spanning the whole cell,
// use_pbc on, and a box region. The first three are the historical rule;
// the map kind and the region policy are the new terms.
TEST_F(MapRegionTest, PBCEligibility)
{
    EXPECT_TRUE(m_pMSR->isUsePBC());
    EXPECT_TRUE(m_pMSR->isPBCEligible(m_pMap, true));
    EXPECT_FALSE(m_pMSR->isPBCEligible(m_pMap, false));

    m_pMSR->setUsePBC(false);
    EXPECT_FALSE(m_pMSR->isPBCEligible(m_pMap, true));
    m_pMSR->setUsePBC(true);

    // EM map: never periodic, even when the block spans the "cell"
    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_EM);
    EXPECT_FALSE(m_pMSR->isPBCEligible(m_pMap, true));
    // ... unless the user forces the crystallographic kind
    m_pMap->setMapType(DensityMap::MAPTYPE_XTAL);
    EXPECT_TRUE(m_pMSR->isPBCEligible(m_pMap, true));

    // full region never wraps
    m_pMSR->setRegionMode(MapRenderer::REGION_FULL);
    EXPECT_FALSE(m_pMSR->isPBCEligible(m_pMap, true));

    // non-DensityMap scalar objects are never periodic
    EXPECT_FALSE(m_pMSR->isPBCEligible(nullptr, true));
}

// The block center must not halve the start index along with the size
// (a cropped block starting at (3,4,5) in a 24-grid, 24 A cell).
TEST_F(MapRegionTest, BlockCenterWithNonZeroStart)
{
    m_pMap->setMapParams(3, 4, 5, 24, 24, 24);
    m_pMap->setXtalParams(24.0, 24.0, 24.0, 90.0, 90.0, 90.0);
    const Vector4D c = m_pMap->getCenter();
    EXPECT_NEAR(c.x(), 3.0 + 2.0, 1e-9);
    EXPECT_NEAR(c.y(), 4.0 + 2.0, 1e-9);
    EXPECT_NEAR(c.z(), 5.0 + 2.0, 1e-9);
}

// The map origin shifts every grid <-> orthogonal conversion.
TEST_F(MapRegionTest, OriginShiftsConversions)
{
    const Vector4D vorig(10.0, 20.0, 30.0);
    m_pMap->setOrigin(vorig);
    EXPECT_TRUE(m_pMap->getOrigin().equals(vorig));

    const Vector4D o = m_pMap->convToOrth(Vector4D(0, 0, 0));
    EXPECT_NEAR(o.x(), 10.0, 1e-9);
    EXPECT_NEAR(o.y(), 20.0, 1e-9);
    EXPECT_NEAR(o.z(), 30.0, 1e-9);

    const Vector4D c = m_pMap->getCenter();
    EXPECT_NEAR(c.x(), 12.0, 1e-9);
    EXPECT_NEAR(c.y(), 22.0, 1e-9);
    EXPECT_NEAR(c.z(), 32.0, 1e-9);

    // grid node (1,2,3) sits at origin + (1,2,3) A; getValueAt truncates
    // to the node, so sample half a grid past it to stay off the edge
    EXPECT_TRUE(m_pMap->isInRange(Vector4D(11.5, 22.5, 33.5)));
    EXPECT_FALSE(m_pMap->isInRange(Vector4D(1.5, 2.5, 3.5)));
    EXPECT_NEAR(m_pMap->getValueAt(Vector4D(11.5, 22.5, 33.5)),
                m_pMap->atFloat(1, 2, 3), 1e-9);
}

// siglevel is a sigma multiple on a crystallographic map and the top percent
// of grid points on a cryo-EM map. The absolute view converts both ways and
// leaves siglevel modified so the level is persisted.
TEST_F(MapRegionTest, SigLevelResolvesByMapKind)
{
    const double rmsd = m_pMap->getRmsdDensity();
    EXPECT_NEAR(m_pMSR->getSigLevel(), 1.1, 1e-9);
    EXPECT_FALSE(m_pMSR->isPercentLevel(m_pMap));
    EXPECT_NEAR(m_pMSR->getLevel(), 1.1 * rmsd, 1e-9);
    EXPECT_TRUE(m_pRend->isPropDefault("siglevel"));

    m_pMap->setDetectedMapType(DensityMap::MAPTYPE_EM);
    EXPECT_TRUE(m_pMSR->isPercentLevel(m_pMap));
    EXPECT_NEAR(m_pMSR->getLevel(), m_pMap->getLevelAtTopFraction(0.011), 1e-9);

    // absolute write: converted through the histogram, flagged modified
    const double abslv = m_pMap->getLevelAtTopFraction(0.25);
    m_pMSR->setLevel(abslv);
    EXPECT_NEAR(m_pMSR->getSigLevel(),
                m_pMap->getTopFractionAtLevel(abslv) * 100.0, 1e-9);
    EXPECT_NEAR(m_pMSR->getLevel(), abslv, 1e-9);
    EXPECT_FALSE(m_pRend->isPropDefault("siglevel"));
}

// The cryo-EM style is where the EM level default lives: applying it writes
// siglevel as a default-flagged value, a reset restores the style value rather
// than the class default, and the crystallographic style falls back to the
// class default.
TEST_F(MapRegionTest, CryoEMStyleIsResetTarget)
{
    qsys::StyleMgr *pSM = qsys::StyleMgr::getInstance();
    if (pSM->getStyleNode("CryoEMIsoSurf", qlib::invalid_uid) == nullptr) {
        // qsys::init() resolves the style dir as %%CONFDIR%%/data/, which
        // does not exist in the source tree, so load the file explicitly
        qsys::StyleFile sfile;
        sfile.loadFile(CUEMOL2_DEFAULT_STYLE_PATH, qlib::invalid_uid);
    }
    ASSERT_NE(pSM->getStyleNode("CryoEMIsoSurf", qlib::invalid_uid), nullptr);

    m_pRend->applyStyles("CryoEMIsoSurf");
    EXPECT_NEAR(m_pMSR->getSigLevel(), 1.0, 1e-9);
    EXPECT_TRUE(m_pRend->isPropDefault("siglevel"));
    EXPECT_TRUE(m_pMSR->isUseAbsLev());
    EXPECT_TRUE(m_pRend->isPropDefault("use_abslevel"));

    m_pRend->setPropReal("siglevel", 5.0);
    EXPECT_FALSE(m_pRend->isPropDefault("siglevel"));
    EXPECT_TRUE(m_pRend->resetProperty("siglevel"));
    EXPECT_NEAR(m_pMSR->getSigLevel(), 1.0, 1e-9);
    EXPECT_TRUE(m_pRend->isPropDefault("siglevel"));

    m_pRend->applyStyles("DefaultIsoSurf");
    EXPECT_NEAR(m_pMSR->getSigLevel(), 1.1, 1e-9);
    EXPECT_FALSE(m_pMSR->isUseAbsLev());
}

/**
 * A map is fitted to its data block, not its unit cell, and to the grid
 * points that reach a level (the drawn contour's extent).
 *
 * An EMDB map often starts at -n/2: fitting the cell put the view half a
 * cell away from the particle. And the whole block of a cryo-EM map is
 * several times the particle, so the view fits what the contour draws.
 */
TEST_F(MapRegionTest, FitBoxesFollowTheDataBlockAndTheLevel)
{
    const int n = 4;
    std::vector<float> data((size_t)n * n * n, 0.0f);
    // One point above the rest, at grid index (1, 2, 3) (column fastest).
    data[1 + n * (2 + n * 3)] = 10.0f;
    DensityMap *pMap = MB_NEW DensityMap();
    pMap->setMapFloatArray(data.data(), n, n, n, 0, 1, 2);
    // Starts at -2 on every axis; a 4 A cell of 4 points: 1 A spacing.
    pMap->setMapParams(-2, -2, -2, n, n, n);
    pMap->setXtalParams(double(n), double(n), double(n), 90.0, 90.0, 90.0);
    qsys::ObjectPtr pObj(pMap);

    qsys::ViewPtr pView(MB_NEW qsys::TTYView());
    // The box JSON's six numbers ({"min":[x,y,z],"max":[x,y,z]}), compared with
    // a tolerance: the cell matrix leaves rounding (-0.9999999999999999, 6e-17).
    auto expectBox = [](const qlib::LString &json, const double (&want)[6]) {
        double got[6] = {0, 0, 0, 0, 0, 0};
        ASSERT_EQ(std::sscanf(json.c_str(), "{\"min\":[%lf,%lf,%lf],\"max\":[%lf,%lf,%lf]}",
                              &got[0], &got[1], &got[2], &got[3], &got[4], &got[5]), 6) << json.c_str();
        for (int i = 0; i < 6; ++i)
            EXPECT_NEAR(got[i], want[i], 1.0e-9) << json.c_str();
    };
    // The block: index 0..4 from start -2, not the cell (0..4 A).
    expectBox(pMap->getFitBoxJSON(pView), {-2, -2, -2, 2, 2, 2});
    // Only the point at (1, 2, 3) + start reaches 5.
    expectBox(pMap->getLevelFitBoxJSON(pView, 5.0), {-1, 0, 1, -1, 0, 1});
    EXPECT_TRUE(pMap->getLevelFitBoxJSON(pView, 100.0).isEmpty());
}

/**
 * Looking an object up by name for a type passes over another object of
 * the same name and a different type.
 *
 * A map fetched for an entry is named after it, as the molecule opened next
 * is: the map boundary (bndry_molname) then found the map, took it for no
 * molecule and dropped the boundary.
 */
TEST_F(MapRegionTest, TypedLookupPassesOverASameNamedObjectOfAnotherType)
{
    molstr::MolCoordPtr pMol(MB_NEW molstr::MolCoord());
    pMol->setName("regmap");
    m_pScene->addObject(pMol);

    // The map came first (the smaller uid), so the untyped lookup gets it.
    EXPECT_EQ(m_pScene->getObjectsByName("regmap").size(), 2u);
    EXPECT_EQ(m_pScene->getObjectByName("regmap").get(), m_pObj.get());
    EXPECT_EQ(m_pScene->getObjectByNameAs<molstr::MolCoord>("regmap").get(), pMol.get());
    EXPECT_EQ(m_pScene->getObjectByNameAs<qsys::ScalarObject>("regmap").get(), static_cast<qsys::ScalarObject *>(m_pMap));
    EXPECT_TRUE(m_pScene->getObjectByNameAs<molstr::MolCoord>("nothing").isnull());
}

