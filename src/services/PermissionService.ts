// SnClipper/src/services/PermissionService.ts
// Vinod Nair
//
// One reusable gate for the Supernote plugin permission system
// (https://docs.supernote.com/en/plugin-base/permission).
//
// The host intercepts shared-storage access (Document, EXPORT, INBOX, MyStyle, Note,
// SCREENSHOT + removable storage) at the process boundary. The plugin's own private dir
// (getPluginDirPath()) is exempt, so clip images, temp captures and AsyncStorage need no
// permission — only the APIs that touch the user's files do.
//
// Permissions must ALSO be declared in PluginConfig.json ("uses-permissions"), otherwise
// requestPermission fails with 1500.

import {PluginManager} from 'sn-plugin-lib';

export const FILE_READ = 'plugin.permission.FILE:READ';
export const FILE_WRITE = 'plugin.permission.FILE:WRITE';

/**
 * granted     — go ahead.
 * denied      — the dialog was shown and dismissed (-1). Re-prompting is fine; the host
 *               shows the 3-option dialog again on the next request.
 * blocked     — user chose "Don't allow" (0). Re-requesting only yields a go-to-Settings
 *               dialog, so point the user at Settings instead of retrying silently.
 * unavailable — the request could not be made at all (the call threw). The expected cause is
 *               a background (showType:0) button press with no foreground UI to host the
 *               dialog; callers that can surface UI should re-ask from there.
 */
export type PermissionOutcome = 'granted' | 'denied' | 'blocked' | 'unavailable';

// Host error codes (docs §"错误码" / error codes).
export const ERR_NOT_DECLARED = 1500; // permission not declared in PluginConfig.json
export const ERR_WRITE_DENIED = 1501; // write attempted without FILE:WRITE
export const ERR_BAD_NAME = 1502; // delete not requested, OR permission does not exist (host reuses 1502 for both)
export const ERR_READ_DENIED = 1503; // read attempted without FILE:READ
export const ERR_PATH_LOCKED = 1217; // path is encrypted/locked

// Verified on Chauvet 2488_beta: the plugin's permission page is
// Settings → Apps → Plugins → Clipper → Permissions, listing "Read Files" and "Modify Files"
// with Allow / Ask Every Time / Don't Allow.
const SETTINGS_HINT = 'Set Read Files / Modify Files to Allow in Settings → Apps → Plugins → Clipper → Permissions.';

export class PermissionService {
  /**
   * Check-then-request a single permission.
   *
   * Never caches the result: "allow this time only" (1) is revoked when the plugin exits,
   * and there is no callback for that, so every gated user action re-checks. hasPermission
   * is cheap; a stale cached "granted" would surface as a raw 1501/1503 mid-flow instead.
   *
   * On a host that predates the permission system (or an SDK without the APIs) this resolves
   * to 'granted' so the plugin keeps working unchanged — the host simply doesn't gate.
   */
  static async ensure(permission: string, desc: string): Promise<PermissionOutcome> {
    if (!this.isSupported()) return 'granted';
    try {
      const has = await PluginManager.hasPermission(permission);
      // 1 = allow this time only, 2 = always allow. Both mean permission is currently held.
      if (has === 1 || has === 2) return 'granted';
    } catch (e) {
      // hasPermission itself is unavailable/failing — treat as an unenforced host rather
      // than blocking a feature that would otherwise work.
      console.warn('hasPermission failed:', e);
      return 'granted';
    }

    try {
      const res = await PluginManager.requestPermission(permission, desc);
      // 0 = don't allow, 1 = allow this time only, 2 = always allow, -1 = dialog dismissed.
      if (res === 1 || res === 2) return 'granted';
      if (res === 0) return 'blocked';
      return 'denied';
    } catch (e) {
      // The dialog could not be shown (e.g. no foreground UI for a background button press).
      // Caller decides whether to surface UI and retry there.
      console.warn('requestPermission failed:', e);
      return 'unavailable';
    }
  }

  /**
   * Ensure several permissions in order, stopping at the first that isn't granted.
   * Used by flows that read layout data and then write (insert, ToC).
   */
  static async ensureAll(
    requests: Array<{permission: string; desc: string}>,
  ): Promise<PermissionOutcome> {
    for (const req of requests) {
      const outcome = await this.ensure(req.permission, req.desc);
      if (outcome !== 'granted') return outcome;
    }
    return 'granted';
  }

  /** True when the running sn-plugin-lib/host pair exposes the permission APIs at all. */
  static isSupported(): boolean {
    return (
      !!PluginManager &&
      typeof (PluginManager as any).hasPermission === 'function' &&
      typeof (PluginManager as any).requestPermission === 'function'
    );
  }

  /**
   * Pull a permission error code out of anything an API call can fail with: a thrown
   * APIError, or a `{success: false, error: {code}}` response object (the SDK returns the
   * latter for most failures rather than throwing).
   */
  static errorCode(e: any): number | null {
    if (!e) return null;
    const code = e?.error?.code ?? e?.code;
    return typeof code === 'number' ? code : null;
  }

  /** True for the codes that mean "the permission you had is gone (or was never granted)". */
  static isPermissionError(e: any): boolean {
    const code = this.errorCode(e);
    return (
      code === ERR_READ_DENIED ||
      code === ERR_WRITE_DENIED ||
      code === ERR_NOT_DECLARED ||
      code === ERR_BAD_NAME
    );
  }

  /**
   * User-facing message for a failed call. Returns null when the failure has nothing to do
   * with permissions, so callers can fall back to their own error text.
   */
  static messageForError(e: any): string | null {
    switch (this.errorCode(e)) {
      case ERR_READ_DENIED:
        return `Clipper lost read access to your files. Try again — or: ${SETTINGS_HINT}`;
      case ERR_WRITE_DENIED:
        return `Clipper lost write access to your notes. Try again — or: ${SETTINGS_HINT}`;
      case ERR_NOT_DECLARED:
      case ERR_BAD_NAME:
        return 'Clipper could not request file access on this firmware (permission not recognised).';
      case ERR_PATH_LOCKED:
        return 'That file is locked or encrypted — unlock it on the device and try again.';
      default:
        return null;
    }
  }

  /** Message shown when the user picked "Don't allow" and re-requesting is pointless. */
  static blockedMessage(action: string): string {
    return `${action} needs file access. ${SETTINGS_HINT}`;
  }
}
