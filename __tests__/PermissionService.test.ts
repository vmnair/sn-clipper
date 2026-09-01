import {
  PermissionService,
  FILE_READ,
  FILE_WRITE,
  ERR_READ_DENIED,
  ERR_WRITE_DENIED,
  ERR_NOT_DECLARED,
  ERR_BAD_NAME,
  ERR_PATH_LOCKED,
} from '../src/services/PermissionService';
import { PluginManager } from 'sn-plugin-lib';

// The permission APIs are looked up on PluginManager at CALL time (isSupported() does a
// typeof check), so tests can add/remove them on the mock to simulate SDK versions.
jest.mock('sn-plugin-lib', () => ({
  PluginManager: {
    init: jest.fn(),
  },
}));

const pm = PluginManager as any;

/** Give the mock the permission APIs, as sn-plugin-lib >= 0.1.65 does. */
function withPermissionApis(has: jest.Mock, request: jest.Mock) {
  pm.hasPermission = has;
  pm.requestPermission = request;
}

describe('PermissionService', () => {
  beforeEach(() => {
    delete pm.hasPermission;
    delete pm.requestPermission;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ensure — outcome mapping', () => {
    it.each([
      [1, 'allow this time only'],
      [2, 'always allow'],
    ])('returns granted without prompting when hasPermission returns %i (%s)', async (code) => {
      const has = jest.fn().mockResolvedValue(code);
      const request = jest.fn();
      withPermissionApis(has, request);

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('granted');
      expect(has).toHaveBeenCalledWith(FILE_READ);
      expect(request).not.toHaveBeenCalled();
    });

    // 1 = "allow this time only", 2 = "always allow" — both mean go ahead now. The difference
    // only matters for how long it lasts, which is exactly why nothing here is cached.
    it.each([
      [1, 'allow this time only'],
      [2, 'always allow'],
    ])('treats requestPermission -> %i (%s) as granted', async (code) => {
      withPermissionApis(jest.fn().mockResolvedValue(0), jest.fn().mockResolvedValue(code));

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('granted');
    });

    it('maps "don\'t allow" (0) to blocked', async () => {
      withPermissionApis(jest.fn().mockResolvedValue(0), jest.fn().mockResolvedValue(0));

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('blocked');
    });

    it('maps a dismissed dialog (-1) to denied', async () => {
      withPermissionApis(jest.fn().mockResolvedValue(0), jest.fn().mockResolvedValue(-1));

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('denied');
    });

    it('maps a throwing requestPermission to unavailable, not denied', async () => {
      // This is what a background (showType:0) press would look like on a host that cannot
      // raise a dialog without a foreground UI. index.js keys its plugin-view fallback off
      // this outcome ALONE, so it must not be collapsed into 'denied'.
      withPermissionApis(
        jest.fn().mockResolvedValue(0),
        jest.fn().mockRejectedValue(new Error('no window token')),
      );

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('unavailable');
    });

    it('passes the caller description through to requestPermission', async () => {
      // The host shows this string in its already-denied dialog, so it must reach the SDK.
      const request = jest.fn().mockResolvedValue(2);
      withPermissionApis(jest.fn().mockResolvedValue(0), request);

      await PermissionService.ensure(FILE_WRITE, 'Clipper needs write access to insert clips.');

      expect(request).toHaveBeenCalledWith(
        FILE_WRITE,
        'Clipper needs write access to insert clips.',
      );
    });
  });

  describe('ensure — hosts that do not gate', () => {
    // These two cases are what keep Clipper working on firmware that predates the permission
    // system. If either regressed to 'blocked'/'denied', every gated flow would refuse to run
    // on older devices while the host was perfectly happy to serve the calls.
    it('returns granted when the SDK has no permission APIs at all', async () => {
      expect(PermissionService.isSupported()).toBe(false);

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('granted');
    });

    it('returns granted when hasPermission itself throws', async () => {
      const request = jest.fn();
      withPermissionApis(jest.fn().mockRejectedValue(new Error('not implemented')), request);

      await expect(PermissionService.ensure(FILE_READ, 'why')).resolves.toBe('granted');
      expect(request).not.toHaveBeenCalled();
    });

    it('reports isSupported true once both APIs exist', () => {
      withPermissionApis(jest.fn(), jest.fn());

      expect(PermissionService.isSupported()).toBe(true);
    });
  });

  describe('ensureAll', () => {
    it('grants only when every permission is granted', async () => {
      const has = jest.fn().mockResolvedValue(1);
      withPermissionApis(has, jest.fn());

      const outcome = await PermissionService.ensureAll([
        { permission: FILE_READ, desc: 'read' },
        { permission: FILE_WRITE, desc: 'write' },
      ]);

      expect(outcome).toBe('granted');
      expect(has).toHaveBeenCalledTimes(2);
    });

    it('stops at the first refusal and does not ask for the rest', async () => {
      // Insert asks READ then WRITE. If READ is refused there is no point prompting for
      // WRITE — the flow is dead either way, and a second dialog would just be noise.
      const has = jest.fn().mockResolvedValue(0);
      const request = jest.fn().mockResolvedValue(0);
      withPermissionApis(has, request);

      const outcome = await PermissionService.ensureAll([
        { permission: FILE_READ, desc: 'read' },
        { permission: FILE_WRITE, desc: 'write' },
      ]);

      expect(outcome).toBe('blocked');
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(FILE_READ, 'read');
    });
  });

  describe('error classification', () => {
    it('reads the code from a thrown APIError and from a failed response object', () => {
      // The SDK returns { success: false, error: { code } } far more often than it throws.
      expect(PermissionService.errorCode({ code: ERR_READ_DENIED })).toBe(ERR_READ_DENIED);
      expect(
        PermissionService.errorCode({ success: false, error: { code: ERR_WRITE_DENIED } }),
      ).toBe(ERR_WRITE_DENIED);
      expect(PermissionService.errorCode(null)).toBeNull();
      expect(PermissionService.errorCode(new Error('boom'))).toBeNull();
    });

    it.each([ERR_READ_DENIED, ERR_WRITE_DENIED, ERR_NOT_DECLARED, ERR_BAD_NAME])(
      'treats %i as a permission error',
      (code) => {
        expect(PermissionService.isPermissionError({ error: { code } })).toBe(true);
      },
    );

    it('does not treat a locked path or an ordinary failure as a permission error', () => {
      // 1217 gets its own message but is NOT a missing grant — re-prompting would not help.
      expect(PermissionService.isPermissionError({ error: { code: ERR_PATH_LOCKED } })).toBe(false);
      expect(PermissionService.isPermissionError({ error: { code: 802 } })).toBe(false);
    });

    it('returns a message for permission-ish codes and null for anything else', () => {
      expect(PermissionService.messageForError({ error: { code: ERR_READ_DENIED } })).toMatch(
        /read access/i,
      );
      expect(PermissionService.messageForError({ error: { code: ERR_WRITE_DENIED } })).toMatch(
        /write access/i,
      );
      expect(PermissionService.messageForError({ error: { code: ERR_PATH_LOCKED } })).toMatch(
        /locked or encrypted/i,
      );
      // Null is the signal for callers to fall back to their own error text.
      expect(PermissionService.messageForError({ error: { code: 802 } })).toBeNull();
      expect(PermissionService.messageForError(new Error('network'))).toBeNull();
    });

    it('points the user at the real Settings route', () => {
      // Verified on device: Settings -> Apps -> Plugins -> Clipper -> Permissions.
      expect(PermissionService.blockedMessage('Inserting clips')).toContain(
        'Settings → Apps → Plugins → Clipper → Permissions',
      );
    });
  });
});
