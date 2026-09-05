// Clipper - Supernote Plugin
// Vinod Nair
//
// Page navigation helpers shared by the insert flow and the ToC builder.
//
// Both need the same thing: after asking the reader to move to a page, do not write to it
// until the reader actually reports being there. A fixed sleep fails on a slow reload and
// wastes time on a fast one, and writing early lands content on the previous page (the
// misdrop seen on device during item 8).

/**
 * Wait until the reader reports it is showing `targetPage`, re-issuing the jump while it
 * has not arrived. Resolves true once settled, false on timeout.
 *
 * The re-issue matters: a single jumpToPage can be swallowed while the note app is busy
 * saving or reloading, and without a retry the poll would just time out.
 */
export const pollForTargetPage = async (targetPage: number, timeoutMs = 4000): Promise<boolean> => {
  const { PluginCommAPI } = require('sn-plugin-lib');
  const start = Date.now();
  let lastJumpTime = 0;
  while (Date.now() - start < timeoutMs) {
    try {
      const pageRes = await PluginCommAPI.getCurrentPageNum() as any;
      if (pageRes && pageRes.success && pageRes.result === targetPage) {
        await new Promise(r => setTimeout(r, 200)); // settle buffer before writing
        return true;
      }
    } catch (e) { /* transient; keep polling */ }

    if (Date.now() - lastJumpTime > 500) {
      try {
        await PluginCommAPI.jumpToPage(targetPage);
        lastJumpTime = Date.now();
      } catch (e) { /* transient; keep polling */ }
    }

    await new Promise(r => setTimeout(r, 150));
  }
  return false;
};
