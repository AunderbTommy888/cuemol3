/**
 * Exports of the native addon that the tritium renderer depends on.
 *
 * bindPeer used to be registered only on macOS / Windows. On Linux the
 * renderer worker's GfxManager.bindCanvas() then failed with
 * "this.cuemol.bindPeer is not a function" and the 3D view stayed black.
 */
import { getModule } from '../index';

describe('cuemol_internal exports', () => {
    it('registers bindPeer on every platform', () => {
        const mod = getModule() as unknown as Record<string, unknown>;
        expect(typeof mod.bindPeer).toBe('function');
    });
});
