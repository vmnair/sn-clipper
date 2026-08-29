# Clipper — Change Log

One entry per applied change: date, files touched, what and why.
Planned work lives in `design_instance/PERMISSION_UPGRADE_PLAN.md`; items move here when landed.

## [Unreleased] — 0.2.0 (permission-system upgrade, in progress)

### 2026-08-28 — Declare permissions + version bump (plan step 3)
Files: `PluginConfig.json`, `package.json`

- Added `uses-permissions: ["plugin.permission.FILE:READ", "plugin.permission.FILE:WRITE"]`.
  Without the declaration every `requestPermission` call fails with 1500. `FILE:DELETE` and
  `INTERNET` are deliberately NOT declared: every file Clipper deletes is inside its own
  private dir (exempt) and it makes no network calls.
- `versionName` 0.1.9 → 0.2.0; `package.json` version kept in sync. `versionCode` left at
  285 on purpose — `buildPlugin.sh` auto-increments it at build time, so the next build
  produces 286 (the plan's target). Setting 286 by hand would have shipped 287.
- `pluginID` (yz6g3rirgcavgon9) and `pluginKey` (SnClipper) untouched.
- Verified `buildPlugin.sh` copies the root `PluginConfig.json` wholesale into
  `build/generated/` (`cp "$root_cfg" "$gen_cfg"`), so the new field carries into the package.

### 2026-08-28 — New PermissionService (plan step 4)
Files: `src/services/PermissionService.ts` (new)

- Check-then-request gate: `hasPermission` → if not 1, `requestPermission(perm, desc)`;
  0 = blocked, 1/2 = granted, anything else (-1/dismissed) = denied. Never caches a grant —
  "allow this time only" is revoked when the plugin exits with no callback, so a cached
  "granted" would resurface as a raw 1503 mid-flow.
- Added a fourth outcome beyond the plan's three: `unavailable`, returned when
  `requestPermission` itself throws. That is the expected symptom of the plan's §3.4 unknown
  (can the host dialog appear from a showType:0 background press?) and lets index.js decide
  at runtime instead of hard-coding an answer.
- Degrades safely on a host/SDK without the permission APIs: `isSupported()` false, and a
  throwing `hasPermission`, both resolve to 'granted' so Clipper keeps working on firmware
  that does not gate.
- Error-code mapping for the shared error paths: 1500/1501/1502/1503/1217 →
  `isPermissionError`/`messageForError`, reading the code from either a thrown APIError or a
  `{success:false, error:{code}}` response (the SDK returns the latter far more often).

### 2026-08-28 — Gate the background Clip handler (plan step 5)
Files: `index.js`, `src/services/ClipService.ts`, `src/services/StorageService.ts`, `src/App.tsx`

- Button 300 now ensures `FILE:READ` before `getLastSelectedText()`.
  - blocked → long toast pointing at Settings → Security & Privacy → Plugins.
  - denied → short "Clipper needs permission to clip"; next press prompts again.
  - unavailable → new `'permission'` launch mode: open the plugin view and re-request from the
    foreground, where a dialog can definitely be shown. This is the plan's §3.4 fallback,
    wired so it only triggers when the background request actually fails.
- `App.tsx` handles the `'permission'` launch mode end-to-end: re-request, then finish the
  clip the user asked for, mirroring index.js's >5-word auto-clip vs. prompt-dialog routing.
- Defense in depth: a 1503 from `getLastSelectedText` (grant expired mid-session) is reported
  as a permission problem rather than silently doing nothing.
- `'permission'` added to the launch-mode unions in ClipService/StorageService.

### 2026-08-28 — Gate the UI flows (plan step 6)
Files: `src/App.tsx`

- Four gates, all at the user-action level (not per API call), via a shared `ensurePermissions`
  helper: **Insert into note** (READ+WRITE, asked together so a missing WRITE can't strand a
  half-written page), **Jump-to-Source** (READ), **Region capture** (READ),
  **Build ToC** (READ+WRITE).
- 'blocked' shows the existing ConfirmationDialog (OK-only) with the Settings route — a toast
  is too easy to miss for a state that will not fix itself; 'denied'/'unavailable' show a
  retry toast.
- 1501/1503/1217 now map to "permission expired — try again"-style messages in the insert,
  jump, capture and ToC error paths (`reportPermissionError`), instead of generic failure text.
- Bug fixed while gating: `runInsertClips` claimed its re-entrancy guard after the new `await`,
  so two quick Insert taps could both slip through and insert twice. Guard is now claimed
  before the first await (caught by the existing "ignores a second Insert tap" test).

### 2026-08-28 — Build, install, test matrix (plan steps 7–8)
Files: none (verification); artifact `build/outputs/SnClipper.snplg` at 0.2.0 / versionCode 288

- Verified `build/generated/PluginConfig.json` carries `uses-permissions` through the build, with
  `pluginID`/`pluginKey` unchanged. Installed on a Manta A5X2 (Chauvet 2488_beta) and ran the
  matrix; results in `design_instance/reports/test-matrix-results.md`.
- **Region capture verdict (plan step 7): KEEP — no feature flag.** `screencap` still works under
  the new host; "Clip Region" produced a correct WYSIWYG crop of a reflowable EPUB page. Brief
  rule 5's fallback was not needed.
- Headline results: background clip prompts in place and clips correctly; insert prompts READ then
  WRITE and inserts with back-links; Jump-to-Source reopens the source at the right page; "Always
  Allow" survives a reboot; with everything denied nothing crashes and every gated flow explains
  itself; clips/settings/images survive with all permissions denied.
- Not exercised: the ToC *write* path (needs a note with handwritten titles) and the 1501/1503
  error mapping (no ungated call ever reached the host). Both recorded in the reports.

### 2026-08-28 — Device findings applied: Settings path + ToC hint copy
Files: `src/services/PermissionService.ts`, `index.js`, `src/components/SettingsPopover.tsx`

- Corrected the Settings route in every permission message. The plan (and my first draft) said
  "Settings → Security & Privacy → Plugins"; the real path, verified on device, is
  **Settings → Apps → Plugins → Clipper → Permissions**, where the two declared permissions
  appear as "Read Files" and "Modify Files" with Allow / Ask Every Time / Don't Allow.
- **Out-of-plan (recorded per brief rule 1):** dropped the stale "Page 1" from the ToC settings
  hint — now "ToC tab & note generator". The ToC builds on any blank page, not page 1, so the
  hint has been wrong since the page-empty pre-check landed. Noticed while running the matrix;
  one-word copy fix, no behaviour change. Also dropped "& Keyword Index" from the stale
  `src/App.tsx` section comment (that feature was deleted in build 284) — comment only, made
  after build 288 was cut, so the installed artifact is unaffected.

### 2026-08-28 — sn-plugin-lib 0.1.43 → 0.1.65 (plan step 2)
Files: `package.json`, `package-lock.json`, `src/App.tsx`, `src/services/IndexService.ts`

- Upgraded `sn-plugin-lib` to 0.1.65 (latest; `npm view` shows 0.1.43 → 0.1.65 with nothing
  in between). Verified `PluginManager.hasPermission(permission)` and
  `requestPermission(permission, desc?)` exist in both the source and the shipped type
  defs (`lib/typescript/src/PluginManager.d.ts:130,144`). Why: 0.1.43 has no permission
  APIs at all, so nothing else in this plan can be built on it.
- **Breaking change fixed —** `PluginDocAPI.generateDocImage(docPath, page, pngPath, size)`
  was removed and replaced by `generateCurrentDocImage(page, pngPath, size, type)`, which
  always renders the currently-open document. `src/App.tsx` region-crop fallback migrated;
  passes `type: 0` (plain page — `type: 1` bakes in text-selection highlight/underline) and
  rounds width/height (the new validator requires integers, range 1–5120). Without this,
  region capture of a PDF/EPUB would have failed on every fallback render.
- **Breaking change fixed —** element indices are now 1-based: `deleteElements`'s
  `numsInPage` and `getElement`'s `num` validate `min: 1` (was `min: 0`), and the `Element`
  model documents `numInPage` as starting at 1. `IndexService.generateTocPage`'s ToC-refresh
  path fell back to the 0-based array index when an element had no `numInPage`; that value
  is now rejected outright. Fallback changed to `i + 1`.
- Other 0.1.65 changes reviewed, none used by Clipper: `PluginCommAPI.setSlideBarStatus`
  removed; `resizeLassoRect` gained an optional `rotationDegree`; new `flipLassoElements`,
  `canHandwrite`, `jumpToPage`, `getPageDisplaySize`, `getPathEncryptionStatus`,
  `unlockPathWithPassword`, `lockPathAccess`, and `PluginFileAPI.openFile(filePath, page)`.
  (`openFile` is a possible future replacement for the native `ImageCropModule.openFileDirectly`
  intent used by Jump-to-Source — not changed here; see session-notes.)

See `design_instance/PERMISSION_UPGRADE_PLAN.md`. Highlights:

- Upgrade `sn-plugin-lib` 0.1.43 → permission-API release.
- Declare `uses-permissions` (`FILE:READ`, `FILE:WRITE`) in `PluginConfig.json`; bump to 0.2.0/286.
- New `src/services/PermissionService.ts` (check-then-request, no grant caching).
- Gate background clip (index.js), insert, jump-to-source, region crop, and ToC flows.
- Handle permission error codes 1501/1503 in shared error paths.
- Screencap (region capture) verdict on new firmware: keep, or feature-flag off pending
  Ratta's official screen-capture API.

## 0.1.9 (versionCode 285) — baseline as of 2026-08-28

Current release. Text + region clips (PDF/EPUB/TXT/CBZ/FB2 and notes), dashboard with
search/filter/sort/merge, insert into notes with back-links and auto-split, ToC feature,
settings; clips persist via AsyncStorage, clip images in the plugin private dir.
Pre-dates the permission system; region capture relies on host `screencap`.
