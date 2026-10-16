# Pull request review

Relay reviews GitHub and Gitea pull requests with lazy diffs, comments, viewed progress, agent-assisted grouping, blame and live project checks. The **Pull requests** page shows what needs you and groups PRs by project. A PR belonging to an added project opens in that project's thread and **Review** pane; other PRs open directly in the Pull requests page.

## Connect to GitHub

Sign in with the GitHub CLI (`gh auth login`) and add the repository as a project. Relay uses that CLI's account for GitHub PRs and CI. **Settings → Integrations → Source control** shows the detected hosts and lets you enable or disable them. The cross-project Pull requests page uses a connected Gitea account when present, otherwise your GitHub account; project threads use the host of their repository.

## Connect to Gitea

1. Enable Gitea under **Settings → Integrations → Source control**, choose **Connect…**, and enter your HTTPS Gitea base URL, including its subpath (for example `https://git.example.com/gitea`). Later sign-ins remember it.
2. Use **Create a token in Gitea** to open your account's Applications settings. Create a personal access token with `read:user`, `write:repository`, and `write:issue`, including private repository access if needed.
3. Enter the token directly in the app. PRs are discovered through your account; you do not need to paste individual links.

The app supports one active Gitea account. Browser OAuth/SSO is not implemented. Login uses Gitea's API and does not import your browser session. Requests use Electron’s native network stack, including system proxy and trusted certificate settings; certificate validation remains enabled. macOS encrypts the saved token using Electron safeStorage backed by Keychain. Linux persists it only when a secure system credential backend is available; otherwise it stays in memory for that session. Disconnect removes the saved token while preserving local review progress.

The window opens while the saved login unlocks. If Keychain needs permission, the app shows its progress and stays responsive; denied access can be retried, or you can sign in again without deleting your review state. Clicking the Dock icon or launching the app again restores a hidden/minimized window. Local development builds are ad-hoc signed, so macOS may request Keychain permission after an update.

## Review workflow

Open **Pull requests** from the sidebar, or choose **Review a PR** when starting a project thread.

The app restores the Pull requests page's saved location, search and open/closed selection. A saved unfinished review can reopen its PR and selected file; closed, merged or approved-at-head PRs do not reopen automatically. Files beyond the first metadata page are located without loading other diffs; if a saved file no longer exists, the first available file opens. An explicitly opened PR URL takes priority.

- The **Needs you** section surfaces PRs awaiting your attention. Project cards open each repository's PRs, ordered around requests for your review, assignments and your own work. Search and open/closed filters query the connected Git host.
- Opening a PR shows its changed files and loads metadata in pages; only the selected file's base and head contents are fetched. Resize panes with their dividers and use the pane controls to show or hide the file list. Cmd/Ctrl F focuses search on the Pull requests page.
- Read split or unified diffs with automatic syntax highlighting and optional line wrapping. Skipped context is shown as a tinted separator labeled **N unchanged lines**. Its arrows reveal 20 lines from either edge; clicking the label reveals both edges. **Expand all** (or Shift-click / Shift-Enter) reveals the whole gap. Controls support Tab, Enter and Space. Expansion uses the selected file’s already-loaded contents and keeps real line numbers for comments and bookmarks.
- Click a line number to add a comment or mark it for later. Drafts, line marks, review summaries, folder links, and viewed files persist locally. Viewed (or V) immediately marks the file and advances to the next unread file, skipping already reviewed files and loading additional file metadata pages as needed. It returns to earlier unread files at the end and stops once all files are reviewed. Revisiting a reviewed file shows it collapsed; expand it without losing its viewed state. Unmarking a file keeps you on it.
- **Finish review** submits comments, approval, or requested changes to the Git host. Replies and resolve/reopen act on existing server comments where supported. The Conversation tab contains PR discussion and review history.
- Viewed marks and drafts are tied to the merge-base/head revision. New commits invalidate viewed status and block stale draft submission. Old drafts remain visible for editing/removal rather than silently attaching to a different line.
- If you already have a pending review in Gitea, finish or discard that review there before submitting here. This avoids unexpectedly publishing comments drafted in another client.
- **Open PR by URL** accepts GitHub and Gitea PR links, including `/files`. Installed builds also register `relay://open?url=<URL-encoded PR URL>`.

| Shortcut         | Action                     |
| ---------------- | -------------------------- |
| Cmd/Ctrl ,       | Open Settings              |
| Cmd/Ctrl F       | Search pull requests       |
| Cmd/Ctrl K       | Open PR by URL             |
| Cmd/Ctrl Alt B   | Toggle review file list    |
| J / K            | Next / previous file       |
| V                | Toggle current file viewed |
| Escape           | Close dialog               |

## Group repeated changes with an agent

Click **Group changes** above the file list. This sends candidate code to the signed-in Claude or Codex agent selected under **Settings → AI models → Used by Relay → Pull request steps**. Choose its model and supported reasoning/Fast settings there. No OpenRouter key or linked local folder is required. Normal review remains lazy; the broader scan runs only when requested and can be paused.

The agent discovers concrete transformation rules directly from the changes. There is no framework/refactor allowlist and no requirement for identical edit text. Local similarity only orders files into small batches. Each packet contains every changed hunk, six lines of surrounding context, and bounded directly referenced changes (for example a changed base class). Earlier unmatched files are checked again when later batches discover new patterns. Only patterns confirmed in at least two files become visible groups.

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

- **Cmd-click** (macOS) or **Ctrl-click** (Windows and Linux) a function or variable on the new side to peek at its definition. The preview leaves the PR and unsaved editor mounted underneath.
- Hover a symbol for its type and documentation. Click a symbol and use **Find usages**, or use the hover actions. Results include project files outside the PR and Angular template usages, with a filter, source preview, and back/forward navigation. Results are limited to the selected compiler configuration and 500 locations; external dependencies are currently omitted.
- In the editor, **F12** goes to definition; **Shift F12** or **Alt F7** finds usages at the caret. Live checks include unsaved buffers and update after a short typing pause. Closing/discarding restores diagnostics for the disk version. Changes made in another editor are watched too.
- Angular detection reads `angular.json` and package metadata, supports application/test configurations, and checks TypeScript plus inline/external templates with the project's strictness settings. Configured TypeScript/JavaScript projects use `tsconfig.json`/`jsconfig.json`, including explicit project references. Next.js receives TypeScript checks against existing generated types; this does not replace `next build`. C++, Flutter and other languages remain reviewable but do not have language support yet.

Install dependencies in the linked project first. Angular needs its matching `typescript`, `@angular/compiler-cli`, and `@angular/language-service` (or `@angular/language-server`). Live support is verified with Angular 21.2.20 and TypeScript 5.9.3. Compiler versions without the TypeScript server API report an explicit unsupported-version error. The app uses a local Node.js installation compatible with those dependencies; it never installs packages, emits build files, or runs package scripts automatically.

One disposable language-service process serves the active PR. It reuses its project graph, debounces edits, has a 768 MiB JavaScript heap limit and a 90-second check deadline, and stops on project switch, disconnect, quit, or checkout mismatch. This consumes additional memory beyond diff review. **Live checks** can be turned off per PR in the checks panel. Content hashes and buffer sequence numbers suppress stale diagnostics and navigation results. Opening older-side symbols is not supported.

## Ask an agent about a line

Click a code row or select a line/range in either diff gutter, then choose **Ask Codex** (or **Ask Claude**, following the line-questions agent in Settings → AI models). Enter your question and click **Ask in Codex**. The app opens an interactive session of that agent's CLI at the linked repository root, carrying the exact PR revision, file path, side, selected lines and up to 25 nearby lines on each side. The session can inspect definitions, callers and tests throughout the repository; follow-up questions continue in that terminal. You can preview the included code before launching.

Questions use a read-only sandbox and do not create Gitea comments or mark files viewed. A dirty or different local checkout is allowed: the prompt distinguishes it from the supplied PR snapshot. Old-side and renamed/deleted-file questions use their merge-base revision and original path. A changed PR revision, missing source or selection over 200 lines blocks the handoff rather than silently using different code. Link a local Git folder with the matching repository remote first.

Open **Settings** from the sidebar's settings button or **Cmd/Ctrl ,**, then **AI models → Used by Relay → Review and commits**. **Pull request steps** and **Line questions** choose the agent, model and supported reasoning/Fast settings for these jobs. Changes save as you make them and persist across restarts. Model and effort availability depend on the installed agent and signed-in account. [Higher reasoning effort gives Codex more room to reason and can increase time and token usage](https://learn.chatgpt.com/docs/models#pick-a-reasoning-effort); [Codex Fast mode uses more credits](https://learn.chatgpt.com/docs/agent-configuration/speed). Existing grouping checkpoints retain their original agent, model, reasoning effort and speed when resumed; new analyses use the latest settings.

## Fix with Codex

Install and authenticate the Codex CLI first, then link the repository's root folder using **Link local folder**. The app checks the Git remote and requires the checkout to match the PR's current head commit. It never checks out or overwrites your working tree automatically.

Use **Fix with Codex** on a line comment or draft. Review the task in the sheet, then launch. macOS opens an interactive Terminal session; Linux uses an available desktop terminal. Codex receives the repository, PR, commit, path, side, line, and comment with `--sandbox workspace-write --ask-for-approval on-request`. The task asks it to preserve unrelated changes, run relevant checks, and avoid committing/pushing unless explicitly requested. Prompt files are private and removed when the terminal script exits. The app does not embed a Codex account or API key.

Linux prefers `xdg-terminal-exec`, honoring Omarchy's selected terminal (Foot, Ghostty, Alacritty or Kitty) and explicitly passing the linked repository directory. Other Linux desktops retain their existing terminal fallbacks. See [Omarchy's terminal settings](https://omarchy.org/manual/terminal/).

## Performance and local data

Diff parsing and syntax highlighting run in workers. Diff and changed-file rows are virtualized; rendered rows follow the viewport. Selected-file contents are released from the query cache when inactive. Syntax worker caches are limited to one entry and two workers. Files over 5,000 lines initially use fast plain text, with explicit syntax opt-in. Each side has a 2 MiB fetch limit; binary/LFS files show a clear message. Diff calculations time out after 12 seconds instead of freezing the window.

Electron still has a substantial baseline footprint. In the measured 15,000-line test, only 40 code rows were mounted and the sum of process working sets was roughly 565–634 MiB across local runs (shared pages may be counted more than once). This is a measurement of one fixture, not a general memory guarantee.

Local review state is stored in Electron's userData directory as `state.json`, using serialized atomic writes and private file permissions. Back up that directory to preserve local drafts. That is `~/Library/Application Support/Relay Experimental` on macOS and `$XDG_CONFIG_HOME/Relay Experimental` or `~/.config/Relay Experimental` on Linux. The token is encrypted; review text and folder paths are not encrypted. Corrupt state files are preserved and surfaced as an error.

