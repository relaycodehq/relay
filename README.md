> **Experimental branch: `experimental/shared-pr-rooms`.** This checkout builds **Review Relay Experimental** with separate application storage; the stable application remains independent. Open a PR and use the chat icon for shared rooms, invitations and `@codex` / `@claude` questions. Read [the room server setup guide](server/README.md) for Mac mini installation, Docker and the precise experimental scope. `npm run package:server` builds the portable server bundle. Agent answers are read-only in this experiment; existing local edit/fix workflows remain separate.

# Review Relay

A desktop Gitea review client for macOS and Linux. Electron + React, with actual MIT-licensed T3 Code diff components and titlebar behavior adapted for a focused review workflow.

## Run the app

- **macOS (Apple Silicon):** quit any running Review Relay, extract `release/ReviewRelay-mac-arm64.zip`, and open its `Review Relay.app`. You can copy it to Applications. This local build is ad-hoc signed, not Apple-notarized.
- **Omarchy (Intel/AMD x86-64):** extract `release/ReviewRelay-Omarchy-x86_64.tar.gz`, open a terminal in the extracted folder, and run `python3 install.py` without sudo. This installs the bundled app and registers **Review Relay** in your app launcher; no Node, Docker or FUSE is needed. The included README covers setup, updates and removal. The installer preserves account/review data and will not overwrite unrelated installations. It requires the usual desktop libraries and enabled Linux user namespaces for Chromium's sandbox.
- **Linux (x86-64):** make `release/Review Relay-0.1.0.AppImage` executable and launch it. `release/review-relay-0.1.0.tar.gz` is also provided. A desktop session and Electron's standard GTK/NSS/GBM libraries are required. AppImage may require your distribution's FUSE compatibility package. Do not disable the Chromium sandbox to work around setup problems.

The Linux package was cross-built; Linux runtime verification is still outstanding. See `VERIFICATION.md` for exactly what was tested.

## Connect to Gitea

1. Leave the server as `https://git.internal.example/gitea`, or enter another HTTPS Gitea base URL (including its subpath).
2. Use **Create a token in Gitea** to open your account's Applications settings. Create a personal access token with `read:user`, `write:repository`, and `write:issue`, including private repository access if needed.
3. Enter the token directly in the app. PRs are discovered through your account; you do not need to paste individual links.

The app supports one active Gitea account. Browser OAuth/SSO is not implemented. Login uses Gitea's API and does not import your browser session. Requests use Electron’s native network stack, including system proxy and trusted certificate settings; certificate validation remains enabled. macOS encrypts the saved token using Electron safeStorage backed by Keychain. Linux persists it only when a secure system credential backend is available; otherwise it stays in memory for that session. Disconnect removes the saved token while preserving local review progress.

The window opens while the saved login unlocks. If Keychain needs permission, the app shows its progress and stays responsive; denied access can be retried, or you can sign in again without deleting your review state. Clicking the Dock icon or launching the app again restores a hidden/minimized window. Local development builds are ad-hoc signed, so macOS may request Keychain permission after an update.

## Review workflow

The app reopens your last unfinished PR and selected file after a reload or full restart, with your inbox filter, search and open/closed selection. Closed or merged PRs, and PRs you have approved at the current head commit, are not reopened automatically. Older, stale or dismissed approvals do not prevent resuming a saved review; completed PRs can still be opened manually. This is saved separately for each Gitea account. Files beyond the first metadata page are located without loading other diffs; if a saved file no longer exists, the first available file opens. An explicitly opened PR URL takes priority.

- **Needs my review**, **Assigned to me**, **Created by me**, and **All pull requests** search across repositories accessible to your account. Search and state filters run on Gitea.
- Pull requests live below the workspace filters on the left. The middle pane shows the selected PR's changed files and loads metadata in pages; only the selected file's base and head contents are fetched. Drag the pane dividers to resize. Each pane has its own hide button; the two controls in the review header restore either pane, even with both hidden. Visibility and widths are remembered. Searching with Cmd/Ctrl F reopens PR navigation without changing file-pane visibility.
- Read split or unified diffs with automatic syntax highlighting and optional line wrapping. Skipped context is shown as a tinted separator labeled **N unchanged lines**. Its arrows reveal 20 lines from either edge; clicking the label reveals both edges. **Expand all** (or Shift-click / Shift-Enter) reveals the whole gap. Controls support Tab, Enter and Space. Expansion uses the selected file’s already-loaded contents and keeps real line numbers for comments and bookmarks.
- Click a line number to add a comment or mark it for later. Drafts, line marks, review summaries, folder links, and viewed files persist locally. Viewed (or V) immediately marks the file and advances to the next unread file, skipping already reviewed files and loading additional file metadata pages as needed. It returns to earlier unread files at the end and stops once all files are reviewed. Revisiting a reviewed file shows it collapsed; expand it without losing its viewed state. Unmarking a file keeps you on it.
- **Finish review** submits comments, approval, or requested changes to Gitea. Replies and resolve/reopen act on existing server comments. The Conversation tab contains PR discussion and review history.
- Viewed marks and drafts are tied to the merge-base/head revision. New commits invalidate viewed status and block stale draft submission. Old drafts remain visible for editing/removal rather than silently attaching to a different line.
- If you already have a pending review in Gitea, finish or discard that review there before submitting here. This avoids unexpectedly publishing comments drafted in another client.
- **Open PR by URL** accepts regular Gitea PR links, including `/files`. Installed builds also register `reviewrelay://open?url=<URL-encoded Gitea PR URL>`.

| Shortcut | Action |
| --- | --- |
| Cmd/Ctrl , | Open Settings |
| Cmd/Ctrl F | Search pull requests |
| Cmd/Ctrl K | Open PR by URL |
| Cmd/Ctrl B | Toggle file list |
| Cmd/Ctrl Shift B | Toggle pull requests |
| J / K | Next / previous file |
| V | Toggle current file viewed |
| Escape | Close dialog |

## Group repeated changes with Codex

Click **Group changes** above the file list. This uses your installed, signed-in Codex CLI (Luna by default) and sends candidate code to Codex. Choose its model and Fast mode in Settings. No OpenRouter key or linked local folder is required. Normal review remains lazy; the broader scan runs only when requested and can be paused.

Codex discovers concrete transformation rules directly from the changes. There is no framework/refactor allowlist and no requirement for identical edit text. Local similarity only orders files into small batches. Each packet contains every changed hunk, six lines of surrounding context, and bounded directly referenced changes (for example a changed base class). Earlier unmatched files are checked again when later batches discover new patterns. Only patterns confirmed in at least two files become visible groups.

Each grouped file must contain only its named transformation and necessary supporting edits. A file with an independent extra change stays in **Individual changes**. Intentional behavior changes can also repeat and be grouped; grouping is a model-assisted review suggestion, not a correctness or safety certification. For an individual file, expand **Why this file is individual** to see its reason. Binary files, incomplete evidence and changes beyond the analysis budget stay individual.
Each completed batch is saved atomically. **Pause analysis** keeps the queue and all valid decisions. **Resume analysis** continues after a budget limit, request failure, app restart, or interruption; it reuses saved evidence instead of downloading and classifying successful files again. Incomplete decisions receive one bounded retry in a smaller request, then remain queued for a later resume. A failed model invocation pauses with its batch queued. Verified groups remain available while work is paused, and no failed decision can mark a file viewed.

Older partial results are recovered without discarding their confirmed groups or semantic individual-file decisions. The old format did not save provisional pattern rules, so singleton matches may need one recovery pass. Newly saved checkpoints retain those rules and their matching queue.

Expand a named group to inspect its files, or use its ⓘ button for the description and file list. **Mark as viewed** marks its eligible files locally for the current revision, collapses the group and advances the diff if the current file was included. Group actions keep the sidebar where you are; explicit file navigation reveals the chosen file. V follows group order, skipping viewed files and completed groups before continuing into individual changes. Next/Previous and J/K use the same order; Show all files uses the original repository order. It does not submit a Gitea approval. **Mark as unviewed** reverses the viewed marks; **Show all files** restores the flat list. Search finds files within collapsed groups. Files with unresolved line discussions, drafts or bookmarks remain individual; the app rechecks discussions and the PR revision before bulk marking.

The private `analysis/` directory now stores the complete changed-hunk evidence, discovered pattern rules, validated hunk coverage, per-file decisions, retry queue, and cumulative usage. Files use owner-only permissions; source packets are stored locally so a restart can resume without sending them again unnecessarily. Raw model transcripts are not retained. Checkpoints are tied to the merge-base/head revision and matcher version. New commits cannot reuse old decisions. Unreadable checkpoints are preserved instead of overwritten.

Work is bounded: up to 1,000 file metadata entries, one file pair fetched at a time (128 KiB per side), 2 million newly prepared evidence characters per run, up to three directly referenced changes / 12,000 additional characters per file, twelve files / roughly 60,000 evidence characters per Luna batch, 128 discovered rules, 40 batches and a 700,000 reported input-token threshold per run (the last completed batch may exceed it). These limits pause unfinished work; each explicit resume gets a fresh run budget while cumulative usage remains visible. Checkpoint storage is capped at 64 MiB. A batch has a 90-second timeout. Complete diffs over 24,000 characters stay individual. Changed hunks are never truncated. Related patches are deduplicated per batch, and the runner uses focused model instructions with coding tools and plugins disabled. Rechecking reuses the already-loaded evidence. The UI reports progress, usage and any budget limit; it never loads the entire repository into one model context.

`npm run test:triage-live` runs a small semantic evaluation with the real signed-in Luna account, covering unrelated API, configuration and styling transformations, cross-batch matching and mixed-file rejection. `npm run test:triage-live -- feature` checks that feature-related logic, markup and styles stay separate while actual repeated operations still group. These consume model usage; ordinary unit/desktop tests use isolated fixtures.

## Edit in the local checkout

Choose **Edit locally** above a file, or from a selected line on the new side of the diff. Link the repository's root folder once. The editor compares the PR head on the left with your editable local working tree on the right, including changes already made in PhpStorm. **Save locally** or Cmd/Ctrl S writes that file only; committing and pushing remain separate steps.

Syntax highlighting, undo/redo, find/replace, indentation, line comments, and multiple cursors come from the existing diff editor. Cmd/Ctrl F finds text, Cmd/Ctrl R opens replace, Cmd/Ctrl D duplicates a line, and Cmd/Ctrl / toggles line comments. Project diagnostics and symbol navigation use the project's TypeScript/Angular language service, as described below. Semantic autocomplete, rename refactoring, debugging, and JetBrains-specific inspections are not implemented.

The linked checkout must match the PR's head commit and repository. Saves check again for new PR commits and disk changes, retain your buffer on conflicts, and atomically replace the file while preserving permissions and UTF-8 BOM/line endings. Closing with unsaved changes prompts first. Reloading can explicitly discard the buffer and reread disk. Editing supports regular UTF-8 files up to 2 MiB; symlinks, hard links, submodules, deleted files, binary/LFS files, and other encodings stay in your IDE. Unsaved code buffers are kept in memory, so save before leaving the app.

## Live project checks and symbol navigation

Hover a line number for its last commit's author, date, short hash, and message. Blame uses the linked local Git repository and the exact revision displayed on that side: merge base on the left, PR head on the right, with the original path for renamed files. Requests start after a short hover, query one line, cancel superseded work, and cache up to 400 results. Split, unified, and expanded context rows are supported. Missing commits explain how to fetch history; shallow clones are labeled. The app does not fetch or change the checkout automatically. In the local editor, modified buffers direct you to the committed PR-head side rather than assigning potentially incorrect authors.

Link the local checkout at the displayed PR head. Supported projects start live checks automatically, even while reviewing; no need to enter the editor. The toolbar opens project-wide problems and the check configuration selector. Changed files show diagnostic badges, and matching PR contents show inline diagnostics and a file problem list. Errors, warnings, and non-blocking suggestions have separate counts, labels, and colors throughout the app. Suggestions include unused code and deprecated APIs; their severity follows the project's compiler configuration. Errors and warnings appear first, and totals include diagnostics beyond the 1,500-item display limit. If your local file differs from the PR, its diagnostics are labeled as local and never attached to the wrong PR lines.

- **Cmd-click** (macOS) or **Ctrl-click** (Linux) a function or variable on the new side to peek at its definition. The preview leaves the PR and unsaved editor mounted underneath.
- Hover a symbol for its type and documentation. Click a symbol and use **Find usages**, or use the hover actions. Results include project files outside the PR and Angular template usages, with a filter, source preview, and back/forward navigation. Results are limited to the selected compiler configuration and 500 locations; external dependencies are currently omitted.
- In the editor, **F12** goes to definition; **Shift F12** or **Alt F7** finds usages at the caret. Live checks include unsaved buffers and update after a short typing pause. Closing/discarding restores diagnostics for the disk version. Changes made in another editor are watched too.
- Angular detection reads `angular.json` and package metadata, supports application/test configurations, and checks TypeScript plus inline/external templates with the project's strictness settings. Configured TypeScript/JavaScript projects use `tsconfig.json`/`jsconfig.json`, including explicit project references. Next.js receives TypeScript checks against existing generated types; this does not replace `next build`. C++, Flutter and other languages remain reviewable but do not have language support yet.

Install dependencies in the linked project first. Angular needs its matching `typescript`, `@angular/compiler-cli`, and `@angular/language-service` (or `@angular/language-server`). Live support is verified with Angular 21.2.20 and TypeScript 5.9.3. Compiler versions without the TypeScript server API report an explicit unsupported-version error. The app uses a local Node.js installation compatible with those dependencies; it never installs packages, emits build files, or runs package scripts automatically.

One disposable language-service process serves the active PR. It reuses its project graph, debounces edits, has a 768 MiB JavaScript heap limit and a 90-second check deadline, and stops on project switch, disconnect, quit, or checkout mismatch. This consumes additional memory beyond diff review. **Live checks** can be turned off per PR in the checks panel. Content hashes and buffer sequence numbers suppress stale diagnostics and navigation results. Opening older-side symbols is not supported.

## Ask Codex about a line

Click a code row or select a line/range in either diff gutter, then choose **Ask Codex**. Enter your question and click **Ask in Codex**. The app opens an interactive Codex CLI session at the linked repository root, carrying the exact PR revision, file path, side, selected lines and up to 25 nearby lines on each side. The session can inspect definitions, callers and tests throughout the repository; follow-up questions continue in that terminal. You can preview the included code before launching.

Questions use a read-only sandbox and do not create Gitea comments or mark files viewed. A dirty or different local checkout is allowed: the prompt distinguishes it from the supplied PR snapshot. Old-side and renamed/deleted-file questions use their merge-base revision and original path. A changed PR revision, missing source or selection over 200 lines blocks the handoff rather than silently using different code. Link a local Git folder with the matching repository remote first.

Open **Settings** from the gear in the review header, the account footer, or **Cmd/Ctrl ,**. **Grouping** and **Line questions** each have a model selector, custom model ID, **Reasoning effort** selector and independent **Fast mode** toggle. Save the settings explicitly; they persist across restarts. Questions may use the Codex-configured default model and reasoning effort. The effort selector shows supported levels for the built-in model presets; custom models depend on the installed CLI. Switching to a model that cannot use the selected effort requires choosing a supported level before saving. [Higher reasoning effort gives Codex more room to reason and can increase time and token usage](https://learn.chatgpt.com/docs/models#pick-a-reasoning-effort). Fast uses Codex's service tier; Standard explicitly overrides an inherited Fast preference. Model and tier availability depend on the signed-in account; [Codex Fast mode uses more credits](https://learn.chatgpt.com/docs/agent-configuration/speed). Existing grouping checkpoints retain their original model, reasoning effort and speed when resumed; new analyses use the latest settings.

## Fix with Codex

Install and authenticate the Codex CLI first, then link the repository's root folder using **Link local folder**. The app checks the Git remote and requires the checkout to match the PR's current head commit. It never checks out or overwrites your working tree automatically.

Use **Fix with Codex** on a line comment or draft. Review the task in the sheet, then launch. macOS opens an interactive Terminal session; Linux uses an available desktop terminal. Codex receives the repository, PR, commit, path, side, line, and comment with `--sandbox workspace-write --ask-for-approval on-request`. The task asks it to preserve unrelated changes, run relevant checks, and avoid committing/pushing unless explicitly requested. Prompt files are private and removed when the terminal script exits. The app does not embed a Codex account or API key.

Linux prefers `xdg-terminal-exec`, honoring Omarchy's selected terminal (Foot, Ghostty, Alacritty or Kitty) and explicitly passing the linked repository directory. Other Linux desktops retain their existing terminal fallbacks. See [Omarchy's terminal settings](https://omarchy.org/manual/terminal/).

## Performance and local data

Diff parsing and syntax highlighting run in workers. The diff, inbox, and file list are virtualized; rendered rows follow the viewport. Selected-file contents are released from the query cache when inactive. Syntax worker caches are limited to one entry and two workers. Files over 5,000 lines initially use fast plain text, with explicit syntax opt-in. Each side has a 2 MiB fetch limit; binary/LFS files show a clear message. Diff calculations time out after 12 seconds instead of freezing the window.

Electron still has a substantial baseline footprint. In the measured 15,000-line test, only 40 code rows were mounted and the sum of process working sets was roughly 565–634 MiB across local runs (shared pages may be counted more than once). This is a measurement of one fixture, not a general memory guarantee.

Local review state is stored in Electron's userData directory as `state.json`, using serialized atomic writes and private file permissions. Back up that directory to preserve local drafts. macOS normally uses `~/Library/Application Support/Review Relay`; Linux normally uses `$XDG_CONFIG_HOME/Review Relay` or `~/.config/Review Relay`. The token is encrypted; review text and folder paths are not encrypted. Corrupt state files are preserved and surfaced as an error.

## Develop and build

Use Node.js 22+ and npm.

```sh
npm ci
npm run dev
```

```sh
npm run build
npm run test:setup
npm test
npm run test:e2e
npm run package:mac
npm run package:linux
npm run package:omarchy
```

`package:omarchy` builds the Linux x86-64 directory and wraps it with the user installer, instructions and a SHA-256 checksum. After an existing Linux build, `python3 scripts/package-omarchy.py` only creates the bundle. `python3 -m unittest discover -s tests/packaging -v` checks install/update/removal and failure recovery using isolated directories. These checks can run on macOS; they do not establish Omarchy runtime compatibility.

`npm run test:setup` installs a pinned Angular/TypeScript toolchain solely for isolated language-service tests. It is not bundled with the app.

`npm run test:e2e` runs the real Electron renderer against an isolated local Gitea fixture, with native windows hidden and activation suppressed. It does not steal desktop focus, open Keychain prompts, or call your private server. The test launcher uses synthetic credential storage; the shipped app always uses its real OS storage. Native window-focus tests require an explicit `RELAY_TEST_HEADED=1`, and OS credential integration requires `RELAY_TEST_NATIVE_STORAGE=1`; leave both unset for normal runs. Linux CI runs under Xvfb; `.github/workflows/desktop.yml` includes desktop tests and artifact builds. That workflow has not been executed remotely yet.

Source layout: `electron/` owns credentials, API calls, disk and process access; `shared/` defines IPC validation and types; `src/` owns the UI; `src/vendor/t3code/` contains the attributed upstream components; `tests/` covers API/state boundaries and desktop flows. There is no demo mode in the shipped app.

## Release status

This is an implemented and locally tested first release, not a claim of production certification. Before distributing broadly: verify the real private Gitea review flow, run Linux desktop tests on the target distribution, validate a real interactive Codex launch, and configure Developer ID signing/notarization. Automatic updates, multi-account switching, browser SSO, merge controls, image previews, and an embedded terminal are not included.

T3 Code provenance and its MIT license are in `THIRD_PARTY_NOTICES.md`.
