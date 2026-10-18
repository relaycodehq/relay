# Project workspace

Add an existing project folder, clone a repository, or create a new project from Relay's project picker. A plain folder can be added without Git, or Relay can set Git up when you choose it; branches, Changes and worktrees need a repository. **Scratchpad** gives each new chat its own folder for work without an existing project.

## Threads and panes

**Activity** shows open threads across projects, including drafts, running work, answers to read and requests that need you. Cmd/Ctrl+1–9 jumps between its cards. Snooze a thread until later, settle it when finished, or open it in its own window. Projects can be arranged in virtual folders such as `Work/Frontend`; this changes the sidebar, not folders on disk.

The conversation sits beside optional **Changes** or PR review and the panel's **Files**, **Terminal**, **History**, **Tasks**, **Browser** and **Device** surfaces. Resize or reorder panes to suit the work. Files open in Relay's editor; file references in an answer can open the relevant diff or file. Unsaved edits prompt before navigation or quitting would discard them.

An agent's commentary, commands, file operations and subagents stream into the thread. Finished work folds behind its elapsed-time row. Questions and approvals stay visible above the composer, including questions the agent asks while it continues working. Answers support copying, read aloud, pinning, replies and forks.

Replies and `/btw` open side conversations without replacing the main thread. `/btw` is available with Claude, Codex and OpenCode. Forking starts a separate thread from a point in the conversation. Drafts are retained per thread and side conversation.

While an agent works, send another message to queue it, or steer the running turn where the agent and message support it. Queue entries retain their agent settings and attachments; reorder them, send or steer now, remove them, or return them to the composer. Send later schedules a message. **Stop** preserves partial output and pauses queued work; **Resume answer** continues the saved conversation. A steer the agent never read is kept for its next turn.

Hosted agent sessions can keep running across a Relay restart. After reconnecting, Relay picks up their state. This does not keep work running through the computer shutting down or the agent process failing.

## Agents and permissions

**Settings → AI & agents → Agents** manages Claude, Codex, OpenCode, Cursor, Amp, Antigravity and agents installed from the ACP registry. Depending on the provider, Relay runs a CLI, SDK or ACP server. Models, reasoning options and commands depend on the installed agent and signed-in account. Claude and Codex support multiple saved accounts; hitting a usage limit does not silently switch accounts.

The composer remembers the chosen agent, model, effort, permissions and Build/Plan mode. A leading `@claude`, `@codex` or another built-in agent's mention overrides the selected recipient; **Message only** saves a message without invoking an agent. Switching agents in an existing conversation can ask the outgoing agent for a handoff note so the next one has context; each provider retains its own session where supported.

Fresh threads default to **Full access** and **Build**. The permission picker describes what the selected agent can enforce:

- **Supervised:** asks before commands and changes where the provider supports approvals.
- **Auto-accept edits:** permits edits and asks for other actions where supported.
- **Auto:** uses the provider's automatic reviewer; agents without one ask.
- **Full access:** permits commands and edits without approval prompts.

Provider differences matter: Cursor's SDK cannot stop to ask, so its restricted modes block actions instead; Amp's own permission rules determine which actions ask. A worktree is a separate checkout, not a security sandbox. **Plan** is separate from permissions, and **Implement plan** requests implementation in Build mode.

Relay supplies its own tools to supported agents for previews, interactive answers, notes, worktrees and coordinating other Relay threads. Ordinary sessions can also use their configured agent tools and integrations; helper jobs and read-only reviewers have tighter policies. Tool availability varies by adapter.

## Notes and pinned answers

Select text in an answer, or use the pin beside a list, code block or table, to keep it in **Notes** beside the composer. Lists become checklists: tick off or reorder items, and quote one item or the unfinished work back into the draft. Kept snippets retain their text and a link to their source answer.

The pin under a whole answer keeps a short label and a pointer back to that message, rather than copying the answer into Notes. Use it to jump back or point a follow-up at the answer. If a rewind removes the message, its pin is marked unavailable and can be unpinned. Agents can keep notes when asked and tick off completed list items through Relay's tools.

## Workspaces and Git

Start a thread in the **Current checkout** or a **New worktree**. An existing thread can move into its own worktree, carrying selected uncommitted files with it. Relay also tracks worktrees created by agents and lets you select the workspace the thread uses. Git, Files, the terminal and future agent turns follow that selection. A deep review uses its review folder when one exists.

If a selected agent worktree disappears, the thread stops using it. **Recreate worktree** is available while its branch remains; **Continue in checkout** explicitly moves future work back to the project folder. Recreation restores the branch's committed files, not uncommitted edits lost with the folder.

**Changes** shows staged, unstaged and conflicted files. Stage and commit selected changes, use **Commit & push**, or have an agent propose a split into logical commits. Turn diffs let you inspect, roll back and redo edits with conflict checks. **History** shows the commit graph and commit diffs. Worktree branches land through a normal merge, and conflicts remain for resolution.

These operations do change Git state. Agents can also run Git within their permissions, and handing a thread to another computer commits uncommitted work for transfer. Optional cleanup removes eligible settled worktree folders while retaining their branches; it is configurable in Settings.

## Files, previews and speech

**Files** provides a file tree, file-name search, an inline editor, Markdown previews and comparison with HEAD. Clean buffers update when files change on disk; unsaved buffers are protected from silent overwrites. Supported TypeScript/JavaScript and Angular projects get diagnostics, definitions and usages from their language services. Install the project's dependencies first. This is not a full IDE; semantic rename and debugging are not implemented.

Each thread has a terminal. **Tasks** lists background processes and offers stop and restart controls. **Browser** opens a live app preview with a separate session for each thread; see [browser previews](previews.md) for server discovery and sessions. **Device** downloads and embeds Expo Device Hub to interact with local Android emulators or iOS simulators; those need the Android SDK or Xcode respectively.

Agents can show self-contained interactive pages, charts and choices inline, as well as images, code, math and diagrams. Scripted pages are checked for errors before display; they run in a restricted frame, separate from the app's own UI.

Download speech models under **Settings → Dictation** and **Settings → Read aloud** to speak messages or listen to answers. Inference runs on the computer. A paired phone sends microphone audio to that computer and receives generated speech over the encrypted connection.

## Composer commands

Type `/` to see Relay commands alongside the selected agent's available commands. Codex skills can be picked with `$name` or `/skill:name`; other providers expose the commands their integration discovers.

| Command | What it does |
| --- | --- |
| `/resume` | Search the project's Claude Code and Codex terminal sessions and continue one in Relay. From an existing thread it opens that session in another thread, or opens its existing Relay thread. |
| `/goal <objective>` | Set a native Claude or Codex goal. Relay shows the state reported by the agent; completion is the agent's judgment. Codex additionally supports pause/resume and reports token budgets when provided. |
| `/btw <question>` | Ask Claude, Codex or OpenCode a side question. |
| `/compact [instructions]` | Summarize earlier context where supported; instructions depend on the provider. The timeline shows context reduction when counts are available. |
| `/context` | Inspect the current context window. |
| `/reload` | Restart a supported agent's session on the same conversation to load changed skills, plugins and instructions. |
| `/provider`, `/model`, `/effort` | Choose who answers and with which settings. |
| `/permissions`, `/plan`, `/fast` | Set permissions, toggle Plan, or toggle Codex Fast mode. |
| `/add-dir <folder>` | Give the thread access to another folder. |
| `/changes`, `/files` | Open the corresponding workspace surface. |
| `/new`, `/clear` | Start a new thread with empty context. |
| `/openpr` | Open the current branch's PR, or prepare one for a supported Git host. |

## Reviews and other devices

GitHub uses your `gh` sign-in; Gitea is configured under **Settings → Integrations**. The titlebar shows CI for the thread's branch, including an older verdict labelled as behind the current commit when the tip has no result. See [pull request review](pr-review.md) for the review workflow.

**Deep review** accepts uncommitted changes, a branch, a commit or a PR. Configure several reviewing models and their prompts, then a lead examines the findings and fixes what holds up. The review stays one thread in the sidebar; open a reviewer from its pane to follow, steer, stop or continue it like any thread, and the lead waits for its latest answer. Findings identify their reviewers, and setups can be saved for reuse.

**Settings → Computers** pairs another Relay for thread handoff. Current versions keep the conversation live on the original computer while the other one runs the agent; Files and Changes still show the local checkout. Offline messages wait, or **Run here instead** continues locally with the conversation already received, leaving the remote computer's later code changes there. A normal **Bring back** transfers the work too. Both computers need the repository added with a matching Git remote; Relay does not clone it during handoff.

The [phone app](phone.md) can follow and answer threads, approvals and questions, inspect changes and commit. The [headless Relay](headless.md) provides those services on a computer without a desktop window.
