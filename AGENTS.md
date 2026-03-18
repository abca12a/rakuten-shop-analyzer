# Repository Guidelines

## Project Structure & Module Organization
This repository contains an extracted Chrome extension package. Active source lives in `1/`. Entry points are `1/manifest.json`, `1/popup.js`, `1/service-worker.js`, `1/options.js`, and `1/src/content-script.js`. Shared logic is split by concern:

- `1/src/api/`: Rakuten API access and connection handling
- `1/src/core/`: storage and data management
- `1/src/popup/`: popup UI modules such as CSV export and message handling
- `1/src/utils/`: error handling and performance helpers
- `1/js/`: older utility/task modules still used by the service worker
- `1/images/`: extension icons

Treat `1/_metadata/` and `*.crx` as packaging artifacts, not primary edit targets.

## Build, Test, and Development Commands
There is no `npm`, bundler, or scripted build in this snapshot. Develop by loading `1/` as an unpacked extension in Chrome:

- `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> select `C:\Users\QYA\Desktop\插件\1`
- Use **Reload** on the extension card after code changes
- Open the popup and run **快速测试** to verify storage, API configuration, and network access

If you need a quick source inventory from the terminal, use `rg --files 1`.

## Coding Style & Naming Conventions
Use ES modules, 2-space indentation, semicolons, and single quotes, matching existing files. Prefer `camelCase` for variables/functions, `PascalCase` for classes, and descriptive file names such as `rakutenApiHandler.js` or `messageHandler.js`. Keep logs and UI text consistent with the current Chinese-language interface.

## Testing Guidelines
Automated tests are not present. Validate changes manually in the unpacked extension:

- test popup flows in `popup.html`
- verify background behavior in `service-worker.js`
- confirm content-script behavior on Rakuten pages
- run the built-in **快速测试** button before submitting changes

Document manual test steps in the PR when behavior changes.

## Commit & Pull Request Guidelines
Git history is not available in this extracted snapshot, so no repository-specific commit convention can be inferred. Use short imperative commits, for example: `fix popup lock recovery` or `add Rakuten URL parsing guard`.

PRs should include a concise summary, impacted files, manual test notes, and screenshots for popup/options UI changes. Link the relevant issue or task when available.

## Security & Configuration Tips
Do not commit real Rakuten `Application ID` values or captured shop data. Keep secrets in extension storage through the options page, and review `host_permissions` in `1/manifest.json` before expanding site access.
