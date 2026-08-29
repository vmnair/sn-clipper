# Clipper — Change Log

One entry per applied change: date, files touched, what and why.
Planned work lives in `design_instance/PERMISSION_UPGRADE_PLAN.md`; items move here when landed.

## [Unreleased] — 0.2.0 (permission-system upgrade, planned)

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
