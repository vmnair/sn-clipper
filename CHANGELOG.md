# Clipper — Change Log

One entry per applied change: date, files touched, what and why.
Planned work lives in `design_instance/PERMISSION_UPGRADE_PLAN.md`; items move here when landed.

## [0.3.0] - 2026-08-30

### 2026-09-03 — Polish: auto-trim works for note clips; silent failures now speak; comments restored
Files: `android/app/src/main/java/com/sn_clipper/ImageCropModule.kt`, `src/App.tsx`, `index.js`, `__tests__/App.test.tsx`

Review decisions D2, D3 and D4 from `design_instance/REVIEW-2026-09-03.md`.

- **Auto-trim never worked for note clips (D3).** `cropImage` advertises trimming empty margins, but `isWhitespace` tested only r/g/b > 245 and ignored alpha. Note captures come back transparent apart from their ink, and a transparent pixel is `(0,0,0,0)` — indistinguishable from black by RGB alone — so the first row scanned read as "not white", the loop broke immediately, and nothing was ever trimmed. Doc captures are opaque white and trimmed correctly, which is why this went unnoticed. Fully transparent pixels now count as whitespace; partially transparent ones are left alone, being the anti-aliased edges of real strokes. **Verified on device (build 335):** the same fixture and crop region that produced a small floating image on build 328 now trims to its content.
- **The page-loop bound stopped silently (§4.3).** Exhausting `pageBudget` ended the run looking exactly like a normal finish, so a user had no idea why the batch stopped or that tapping Insert again continues it. It now says so, and the clips stay queued as before.
- **A partial layer capture said nothing (§4.5).** When some of a note page's layers render and others fail, compositing what we have still beats failing the capture — but the clip is then missing content that is visible on the page, which is the same class of silent loss the layer composite exists to remove. It now warns.
- **Restored on-device calibration comments deleted by the item-8 rewrite (§4.4).** Why `imageLeftInset` is `0.6·fontSize` (measured on Manta), why image size is never upscaled (the note app's OpenCV resize reads past the source bounds and crashes it), and why `getElemBottom` clamps to `pageHeight - 120` (a digitizer-noise guard; strokes are now included deliberately so inserts land below handwriting, with the clamp filtering instead of the old skip-strokes rule). That knowledge had been left only in git history.
- **Corrected a comment that asserted a platform limitation that does not exist (D2).** `runInsertClips` claimed the host does not implement `insertNotePage`. It does — pass a rendered PNG path from `generateNoteTemplatePng`; a style name from `getNotePageTemplate` fails with 802. The guidance modal is a 0.3.0 choice, not a platform limit, and conversion to ask-then-create is deferred to 0.3.1. That comment was the vector by which the wrong conclusion propagated into the release plan.
- Removed an unused `isNoteFile` import from `index.js` (§4.6).
- 150/150 tests passing; the new partial-layer warning has a regression test that fails with the warning removed.

### 2026-09-02 — Fix: Note region capture dropped content on non-main layers
Files: `src/App.tsx`, `android/app/src/main/java/com/sn_clipper/ImageCropModule.kt`, `__tests__/App.test.tsx`

- `generateLayerPreviewImage(file, page, 0, out)` renders **one** layer. A Standard note can carry ink on layers other than the main one, so capturing layer 0 alone silently dropped it. **Confirmed on-device (build 327):** a fixture with a `Main Layer 0` text box on the main layer and pen ink on Layer 1 produced a clip containing the text and none of the ink — verified on PNGs pulled off the device, not on a screenshot.
- Diagnostic build established the facts the fix needed, all on-device: `getLayers` returns only the layers that exist, as `{layerId, name, isVisible, isCurrentLayer}` with **no** `isBackgroundLayer` flag, so `layerId` is the only way to identify the template; `layer: -1` renders the **background template alone** (so it is not an "all layers" shortcut) and comes back **opaque white**, while content layers come back **fully transparent** except for their ink; and `layer: 2`/`3` on a page that lacks them fail with code 808 rather than rendering empty.
- Fix: enumerate with `PluginFileAPI.getLayers`, keep visible layers with `layerId >= 0` (excluding -1, the template), render each to its own PNG and flatten them bottom-up via a new native `ImageCropModule.compositeImages(paths, destPath)` — a plain source-over draw onto one ARGB canvas, which is correct precisely because the layer renders are transparent. Output keeps its alpha so the crop and insert paths downstream see the same kind of image they always did.
- Deliberately unchanged in the common case: a page with a single content layer renders straight to the destination with no compositing, so notes that only use the main layer (all 31 on the test device) gain no new failure mode. Falls back to the bottom content layer if compositing fails, and to layer 0 if `getLayers` is unavailable, so an older host cannot end up with no capture at all.
- **Verified on-device (build 328):** the same fixture now captures both the Layer 1 ink and the Main Layer text, with the ruled template still correctly excluded — confirmed in the crop overlay, in the saved clip, and finally on the exported PNG pulled off the device. 149/149 tests passing.
- Also reconfirmed on 327 for the Ratta report: `generateNotePng` with `type: 0` still composites the page template.

### 2026-09-01 — Fix: Auto-remove could delete clips whose inserts never landed
Files: `src/App.tsx`, `__tests__/App.test.tsx`

- The multi-page rewrite dropped the pre-existing check that inserted elements are actually present in the note before auto-remove deletes the clips they came from, and dropped the "Some clips could not be inserted" toast with it. Auto-remove ran on `attemptedInserts > 0`, so a run where every insert silently dropped still deleted every clip — content gone from Clipper and never in the note. `insertImage` is the realistic case: it can resolve successfully and leave nothing behind.
- Fix: restore the verification, adapted to the page loop. Each page snapshots the element uuids present before its inserts and, after saving, counts how many new uuids landed; auto-remove now requires the running total to cover every attempted insert. When it does not, the clips are kept, the failure is reported, and the plugin view stays open instead of claiming success. This also puts the per-page `beforeIds` set back to use — it was still being built and then ignored.
- Added a regression test: an insert whose verification reports no new elements keeps its clip, warns, and does not close the view. Confirmed it fails (clip deleted) with the guard reverted. 145/145 tests passing.

### 2026-08-31 — Fix: Stale split-remainder could corrupt a later merged-clip element
Files: `src/App.tsx`, `__tests__/App.test.tsx`

- **Dead code:** Removed `stoppedEarlyDueToSplit` in `runInsertClips` — declared but never assigned (a leftover from the pre-Item-8 single-page code, where an equivalent `splitOccurred` flag was set explicitly; the assignment was dropped when Item 8 restructured this into the multi-page loop). The final status-message check now just reads `splitRemainder[items[i]?.clipId]` directly.
- **Real bug found while investigating it:** `splitRemainder[clipId]` was set whenever a text item got split across pages, but was never cleared once that item later completed via the "fits whole" path (single item or combine-group). For a **merged clip** with more elements after the split one, if the insert run ended before those later elements were ever attempted, `ClipService.trimInsertedElements` would splice the stale leftover text from the *earlier, already-resolved* split onto the *next, untouched* element — silently corrupting its content.
- Fix: clear `splitRemainder[clipId]` at the exact point an item (or combine-group member) completes successfully, so a resolved split can never leak onto a later element of the same clip.
- Added a regression test that merges 3 clips (`E1` long enough to split, `E2`, `E3`), drives the run to Page-Full right after `E1`'s split resolves and before `E2` is ever attempted, and asserts `E2`/`E3` survive byte-for-byte. Verified the test fails (reproducing the exact corruption) with the fix reverted, and passes with it restored. 144/144 tests passing.

### 2026-08-31 — Fix: Note Region Capture Baking Template Ruled Lines
Files: `src/App.tsx`, `__tests__/App.test.tsx`

- **Build 324 attempt (insufficient):** Changed `generateNotePng`'s `type: 1` → `type: 0` (SDK docs: 0 = transparent background). Confirmed on-device (pulled the raw capture from `/sdcard/.data/plugin/` directly) that ruled lines were still baked into the PNG — `type` does not control template compositing on this firmware (Chauvet `3.29.43_beta`), contrary to the SDK doc comment.
- **Build 325 fix:** Made `PluginNoteAPI.generateLayerPreviewImage(notePath, page, 0, pngPath)` the primary render path for note region-capture instead of `generateNotePng` — it renders only the element/handwriting layer, not the page background template. `generateNotePng` (`type: 0`) is now only a fallback if the layer-preview call fails.
- Updated/added unit tests covering both the primary `generateLayerPreviewImage` path and the `generateNotePng` fallback.
- See `design_instance/current_status.md` for the full investigation (this was compounded by a since-fixed `PermissionService` bug that misidentified "Always Allow" as ungranted, forcing a raw framebuffer screencap fallback with visible UI/template lines).

### 2026-08-30 — Item 8: Auto Page-Turn & Guided Page Full Pagination
Files: `src/App.tsx`, `src/components/ConfirmationDialog.tsx`, `src/utils/paths.ts`, `__tests__/App.test.tsx`

- **Item 8 (Auto Page-Turn on Insert across Existing Pages & Guided Page Full UX):**
  - Wrapped `runInsertClips` in a multi-page loop bounded by `pageBudget = 20`.
  - Added per-page dimension and robust element bottom calculation via `PluginFileAPI.getPageSize` and `PluginFileAPI.getElements` with comprehensive stroke bounding (`getElemBottom`).
  - Implemented seamless auto page-turn via `PluginCommAPI.jumpToPage(nextPage)` with active settling polling when subsequent pages exist in the note.
  - Implemented single-button **"Page Full"** modal when reaching the final note page, instructing users to add a page via toolbar `+` while safely preserving queued uninserted clips for instant resume.
  - Added password-locked file pre-check in `handleOpenSource` via `PluginFileAPI.getPathEncryptionStatus`.
  - Added unit test cases in `__tests__/App.test.tsx` covering all multi-page auto-turn, existing-page continuation, and Page Full guidance scenarios.

### 2026-08-30 — Item 7: Region Capture in NOTE Files
Files: `index.js`, `__tests__/App.test.tsx`

- **Item 7 (Region Capture in NOTE files):** Extended dedicated "Clip Region" button (ID 101) registration from `['DOC']` to `['NOTE', 'DOC']` so region capture is accessible directly from note toolbars.
- Verified fallback render branching in `App.tsx` routes note files to `PluginFileAPI.generateNotePng` and document files to `PluginDocAPI.generateCurrentDocImage`.
- Added unit test coverage in `App.test.tsx` verifying fallback crop screenshot routing for both note and document contexts.

### 2026-08-29 - Version 0.3.0 Feature Release
Files: `index.js`, `src/App.tsx`, `src/services/ClipService.ts`, `src/services/IndexService.ts`, `src/services/StorageService.ts`, `assets/icon/*`, `PluginConfig.json`, `package.json`

- **Item 3 (1501/1503 Error Wiring):** Checked return results of `replaceElements` and `deleteElements` in `IndexService.generateTocPage`, and `modifyElements` in `App.tsx` image insertion; routed error codes to `reportPermissionError`.
- **Item 4 (Jump-to-Source SDK Migration):** Migrated `handleJumpToSource` from native `ImageCropModule.openFileDirectly` to official `PluginFileAPI.openFile(filePath, page)`.
- **Item 1 (Region-Capture Toolbar Button):** Registered dedicated type 1 button (ID 101, `['DOC']`, `showType: 0`) named "Clip Region" with background screencap before opening `CropOverlay`. Added `cropActiveRef` and `waitForPendingCropShot` to eliminate cold-start AppState active race conditions.
- **Item 6 (Icon Overhaul):** Redrew `icon.png` using a bold geometric viewfinder design with text highlight bars (Concept A) to form a unified visual sibling pair with `clip_region.png` (viewfinder + crosshair) at 160px stroke weight. Preserved original dashboard search, filter, settings, jump, and clear icons; added bold 'X' `close.png`.
- **Item 2 (Adaptive ToC Submenus):** Implemented adaptive heading style mapping in `IndexService.scanHeadings` and level-based indentation in `generateTocPage` and in-app ToC tab.
- **Item 5 (Sticker Route Research):** Completed SDK sticker API research and delivered findings in `design_instance/reports/sticker-route-findings.md`.

## [0.2.0] - 2026-08-28 (permission-system upgrade)

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
- Defensive 1501/1503/1217 mapping (`reportPermissionError`) added to the insert, jump,
  capture and ToC error paths. Caveat (found 2026-08-29): the write paths do not yet surface
  error codes to it — `IndexService` discards `replaceElements`/`deleteElements` results and
  the image-insert path drops the code from `modifyElements` — so the mapping is effectively
  unreachable there today. Not a live bug (the up-front gates prevent the scenario); wiring
  the return-value checks is planned for 0.2.1.
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

### 2026-08-29 — ToC write path exercised on device (review item 2)
Files: none (verification); artifact 0.2.0 / versionCode 290

Run against a real 32-page note with 25 handwritten titles, permissions granted:

- **First build:** produced a correct ToC page (25 entries with page numbers and jump links).
  API tally from the host log: 53 `insertText`, 25 `insertTextLink`, 9 `recognizeElements`,
  1 each of `saveCurrentNote` / `getPageSize` / `getNoteTotalPageNum` / `getElements` — and
  **zero `replaceElements`/`deleteElements`**. A first-time ToC build therefore touches no
  WRITE-gated API at all, exactly as the decompiled host predicted.
- **Refresh:** rebuilding over the existing ToC called `replaceElements` (the WRITE-gated call)
  and regenerated cleanly — same 25 entries, timestamp updated, no duplication or overlap.
- Page-empty guard behaved correctly throughout: it refused a page holding a title element, and
  only proceeded once a blank page was added.

**Gap found while verifying — 1501/1503 handling is effectively unreachable as wired.** The SDK
returns `{success: false, error: {code}}` rather than throwing, but `IndexService`'s ToC-refresh
block discards the results of `replaceElements`/`deleteElements` and only catches thrown errors,
and `App.tsx` checks `modifyElements`'s `success` flag while dropping the code. So a real 1501
would be swallowed silently in both write paths. This is not a live bug — the gates request WRITE
up front for both ToC and image-insert, so the situation should not arise — but the
"defense in depth" is not currently in depth. Left as-is and reported rather than changed,
since wiring return-value checks through those paths is a behavioural change beyond this review.

### 2026-08-29 — Insert asks for FILE:WRITE only when it needs it (review item 1)
Files: `src/App.tsx`, `src/services/PermissionService.ts`, `CHANGELOG.md`,
`__tests__/PermissionService.test.ts` (new), `__tests__/App.test.tsx`

Settled by decompiling the host (`jadx` on `/system_ext/app/PluginHost/PluginHost.apk`) and
reading `HostCommImpl.checkFileWritePermission` rather than guessing from the host's UI wording:

```java
if (isPluginPrivatePath(api, path) || SecurityManager.hasPermission(pluginID, 2)) return true;
cb.onResponse(new PluginAPIResponse(PluginAPIError.PERMISSION_NO_REQUEST_WRITE)); // 1501
```

The rule is: **APIs taking a file path are gated; APIs acting on the currently-open editor are
not.** Verified per method — `insertText`, `insertTextLink`, `saveCurrentNote`, `reloadFile`,
`getLastElement`, `getLastSelectedText`, `getCurrentFilePath`, `getCurrentPageNum`,
`recognizeElements` and `generateCurrentDocImage` carry no check at all; `insertImage` has only
an encryption check; `getElements`/`getPageSize`/`getTitles`/`getNoteTotalPageNum` are READ;
`modifyElements`/`replaceElements`/`deleteElements` are WRITE.

- **Insert now requests WRITE only when the batch contains an image clip.** The only WRITE-gated
  call in the flow is `modifyElements(notePath, …)`, used purely to reposition an image after
  `insertImage`. A text-only insert was prompting for a permission it never used — and would
  have refused to run for anyone who denied "Modify Files", losing working functionality.
- **ToC gate unchanged (READ+WRITE).** A first-time build only inserts (ungated), but a refresh
  calls `replaceElements`/`deleteElements`; which one applies is unknown until after the scan,
  so asking up front stays correct.
- **Plan §6 Q7 answered:** `reloadFile` is not gated at all — neither READ nor WRITE.
- **Why note region-capture works on READ alone:** `generateNotePng` checks READ on the note path
  and WRITE on the output PNG path, but the PNG goes to the plugin private dir, which
  `isPluginPrivatePath` exempts.
- Corrected the `ERR_BAD_NAME` comment: the host reuses **1502** for both "delete permission not
  requested" and "permission does not exist".
- Added `__tests__/PermissionService.test.ts` (20 tests): full `ensure` outcome mapping
  (held / 1 / 2 / 0 / -1 / throw→`unavailable`), both no-gating fall-throughs, `ensureAll`
  short-circuiting, and error classification. Renamed a stale `generateDocImage` mock in
  `App.test.tsx` to `generateCurrentDocImage`. Suite: 102 → **122 passing**.
- Removed the superseded "[Unreleased] Highlights" planning block (review item 4).

**Confirmed on device** (build 290, Manta A5X2 / Chauvet 2488_beta): with Read Files = Allow and
**Modify Files = Don't Allow**, a two-clip text insert succeeded — both clips landed with their
source back-links — and the host log shows a single `hasPermission(FILE:READ)` with no WRITE
query, no prompt and no blocked dialog. The ToC write path was exercised too (see next entry).

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

## 0.1.9 (versionCode 285) — baseline as of 2026-08-28

Current release. Text + region clips (PDF/EPUB/TXT/CBZ/FB2 and notes), dashboard with
search/filter/sort/merge, insert into notes with back-links and auto-split, ToC feature,
settings; clips persist via AsyncStorage, clip images in the plugin private dir.
Pre-dates the permission system; region capture relies on host `screencap`.
