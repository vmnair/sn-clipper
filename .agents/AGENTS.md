# Workspace Agent Rules & Guidelines

- **Version Bumping Requirement**:
  - Bump the `versionName` (minor or patch digit) in both `package.json` and `PluginConfig.json` **only when adding a new feature** (e.g., `0.1.4` → `0.1.5`).
  - For all other/incremental changes (bug fixes, tweaks, iteration), do **not** bump `versionName` — just run the build script, which auto-increments the `versionCode` (build number) in `PluginConfig.json`.
  - The `versionCode` is what the Supernote OS uses to detect and re-install an updated package, so incrementing it alone prevents caching issues; `versionName` is the human-facing release label.

- **Version & Build Logging Requirement**:
  - After running any build (`./buildPlugin.sh`) or deploy (`./deploy.sh`) command, always read [PluginConfig.json](file:///Users/vinodnair/Projects/sn-clipper/PluginConfig.json) and display the current `versionName` and `versionCode` (build number) in the console/chat response.

- **Default Project Path**:
  - The active project repository is located at `/Users/vinodnair/Projects/sn-clipper` (or `~/Projects/sn-clipper`). Always check this path when referencing the Clipper plugin codebase.

- **Thorough Research Requirement**:
  - Before writing code or proposing implementation changes, thoroughly investigate the API capabilities, documentation, execution boundaries, and hardware/firmware platform context. Ensure all design decisions and assumptions are discussed and verified with the user prior to implementation.

- **Implementation Plan Location**:
  - Always place the `implementation_plan.md` directly inside the repository workspace's `plan/` folder (i.e. `plan/implementation_plan.md`). The developer instance will always look there for instructions and details to execute.

- **Default to Brainstorming Mode**:
  - Always start the conversation in **Brainstorming Mode** (i.e. purely conceptual analysis, discussion, and Q&A).
  - Explicitly confirm this mode at the beginning of responses with a `🧠 Status: Brainstorming Mode` header.
  - Never modify files, write code, stage files, or run compile/build scripts (like `./buildPlugin.sh`) unless the user explicitly and directly instructs you to do so in the current turn.

