// Runs in Web Worker thread. Wrappers are sync (no await on C++ wrappers).
import type { Object as CueMolObject } from '@cuemol/core/src/wrappers/Object';
import type { Renderer } from '@cuemol/core/src/wrappers/Renderer';
import type { WorkerContext } from '@renderer/worker/server/types/WorkerContext';
import {
    parseSceneTreeJSON,
    type SceneNodeType,
    type SceneTreeNode,
} from '@renderer/worker/shared/sceneTreeTypes';
import { withUndoTxn } from '../withUndoTxn';
import { recordOp } from '@renderer/worker/server/actions/serviceOps';
import { getSceneOrNull } from '@renderer/worker/server/services/helpers/sceneResolver';
import { listGroupChildRenderers } from '@renderer/worker/server/services/helpers/groupChildren';

export interface GetSceneTreeArgs {
    sceneId: number;
}

export interface GetSceneTreeResult {
    ok: boolean;
    tree: SceneTreeNode | null;
}

export interface SetNodeVisibleArgs {
    sceneId: number;
    nodeId: number;
    nodeType: SceneNodeType;
    visible: boolean;
}

export interface SetNodeVisibleResult {
    ok: boolean;
}

export interface SetNodeUiCollapsedArgs {
    sceneId: number;
    nodeId: number;
    /** Only real C++ nodes persist collapse state (UXP onTwistyClick). */
    nodeType: 'object' | 'rendGroup';
    collapsed: boolean;
}

export interface SetNodeUiCollapsedResult {
    ok: boolean;
}

export function getSceneTree(ctx: WorkerContext, args: GetSceneTreeArgs): GetSceneTreeResult {
    const scene = getSceneOrNull(ctx, args.sceneId);
    if (!scene) return { ok: false, tree: null };
    const json = scene.getSceneDataJSON();
    const tree = parseSceneTreeJSON(json);
    if (!tree) return { ok: false, tree: null };
    // Cameras and style sets are not part of the tree: the Camera pane
    // (`listCameras`) and the Style Sets pane (`listStyleSets`) show them.
    return { ok: true, tree };
}

export function setNodeVisible(
    ctx: WorkerContext,
    args: SetNodeVisibleArgs,
): SetNodeVisibleResult {
    // Only object / renderer / rendGroup carry a real visibility flag.
    if (
        args.nodeType !== 'object' &&
        args.nodeType !== 'renderer' &&
        args.nodeType !== 'rendGroup'
    ) {
        return { ok: false };
    }
    const scene = getSceneOrNull(ctx, args.sceneId);
    if (!scene) return { ok: false };

    if (args.nodeType === 'rendGroup') {
        // A group's visible flag has no effect on 3D drawing by itself
        // (RendGroup::display() is empty and the C++ scene loop checks
        // each renderer's own flag), so cascade the value to every member
        // renderer inside one txn -- UXP `toggleVisibleRendGrp` parity.
        const grp = scene.getRenderer(args.nodeId) as Renderer | null;
        if (!grp) return { ok: false };
        withUndoTxn(scene, 'Change group visibility', () => {
            recordOp(ctx, scene.uid, 'set_visible', { nodeId: args.nodeId, nodeType: 'rendGroup', visible: args.visible }, ['nodeId']);
            grp.visible = args.visible;
            for (const child of listGroupChildRenderers(scene, grp)) {
                child.visible = args.visible;
            }
        });
        return { ok: true };
    }

    const label = args.visible ? 'Show' : 'Hide';
    withUndoTxn(scene, label, () => {
        recordOp(ctx, scene.uid, 'set_visible', { nodeId: args.nodeId, nodeType: args.nodeType, visible: args.visible }, ['nodeId']);
        if (args.nodeType === 'object') {
            const obj = scene.getObject(args.nodeId) as CueMolObject;
            if (!obj) return;
            obj.visible = args.visible;
        } else {
            const rend = scene.getRenderer(args.nodeId) as Renderer;
            if (!rend) return;
            rend.visible = args.visible;
        }
    });
    return { ok: true };
}

/**
 * Persist the tree-row expand/collapse state into the C++ `ui_collapsed`
 * property so it survives a qsc save/load round-trip. UXP parity:
 * `workspace_panel.js` `onTwistyClick` writes the flag directly with NO
 * undo txn (a collapse is not an edit; propChanged skips undo recording
 * outside an active txn). The renderer side filters the resulting
 * `ui_collapsed` PROPCHG event so this write does not trigger a refetch.
 */
export function setNodeUiCollapsed(
    ctx: WorkerContext,
    args: SetNodeUiCollapsedArgs,
): SetNodeUiCollapsedResult {
    if (args.nodeType !== 'object' && args.nodeType !== 'rendGroup') {
        return { ok: false };
    }
    const scene = getSceneOrNull(ctx, args.sceneId);
    if (!scene) return { ok: false };
    const target =
        args.nodeType === 'object'
            ? scene.getObject(args.nodeId)
            : scene.getRenderer(args.nodeId);
    if (!target) return { ok: false };
    (target as unknown as { ui_collapsed: boolean }).ui_collapsed =
        args.collapsed;
    return { ok: true };
}
