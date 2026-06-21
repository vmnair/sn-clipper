# Workspace Agent Rules & Guidelines

- **Version Bumping Requirement**:
  - Always bump the `versionName` in both `package.json` and `PluginConfig.json` (e.g., from `0.0.3` to `0.0.4`) and run the build script (which increments the `versionCode` in `PluginConfig.json`) whenever changes are made to the codebase.
  - This ensures that the Supernote OS updates the installed plugin package on the device correctly and prevents caching issues.
