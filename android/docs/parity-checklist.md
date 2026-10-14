# Relay phone app (Expo) to Kotlin/Compose feature-parity checklist

Base path: `/Users/lubomirmolin/Library/Application Support/Relay Experimental/worktrees/relay/kotlin-phone/mobile/` (written as `M/` below). Items marked **[verify]** come from the file's name, doc comment or grep hits; I didn't read those files line by line.

## 1. Transport and protocol
- [ ] WebSocket to the bridge on default port 47821; hosts tried in a staggered order. `M/../shared/remote-client.ts`
- [ ] Handshake: plaintext `{t:"hello",v,e}` with an X25519 ephemeral key; the desktop's static key is pinned from the QR; HKDF-SHA256 with salt `relay-remote/1`; ChaCha20-Poly1305 with counter nonces. `M/../shared/remote-crypto.ts`
- [ ] Frames before compactBridge (14) are base64url text. From 14 on they are binary: sealed, then a flag byte (0 = raw, 1 = raw-DEFLATE when 256B to 1MB), then JSON. `M/../shared/remote-wire.ts`
- [ ] Client frames: `pair`, `auth`, `call{id,method,args}`, `got{s}`. Server frames: `paired`, `ready`, `denied`, `result`, `event{event,s?}`, `tick` (every 15s; no tick means the link is stale).
- [ ] Call timeouts are 15s, or 120s for slow methods. Reconnect uses exponential backoff; `wake()` runs on AppState active; while on a later route it keeps looking for a better one.
- [ ] Routes are `local` or `tailscale` (100.64–127.x, `fd7a:115c:a1e0:`, `*.ts.net`). Order is user-set; `learnHosts` keeps up to 8. `M/../shared/remote-routes.ts`
- [ ] Events: message, chats, appearance, draft, handoff. `messagePatch`/`chatsPatch` are applied by the delta code.
- [ ] Bridge-version gates (remoteBridgeVersion 21): recipient 11, readAloud 12, activityDetail/away 13, image/compact 14, subagents/title/markedUnread 15, workspace 16, render 17, liveHandoff 18, drafts 19, folder/start handoff 20, skills 21.
- [ ] RemoteApi methods: overview, chat, diff, desktop, projectIcons, subagents, subagentRun, phoneAppFile, reportApp, dictate, readAloud, activityDetail, image, renderPage, saveDraft, draftOther, sendDraft, computerInfo, updateNow.
- [ ] The `desktop(method, …)` allowlist (`phoneDesktopMethods`) is the full set of desktop methods listed in the summary. Port all of them.

## 2. Pairing and multiple computers
- [ ] Pairing URL `relay-remote://pair?h=&p=&k=(43 b64url)&c=(16–64)&n=`, also accepted inside wrappers like `exp://…/--/pair?`. `parsePairingUrl` in shared.
- [ ] Pair screen. `M/src/app/pair.tsx`
  - From a deep link: "Pair this phone with X?" with a Pair button.
  - Otherwise: camera QR scanner (permission prompt, "Use the camera" button), scans debounced 1.5s.
  - "Paste pairing link" reads the clipboard.
  - Error text: "That isn't a Relay pairing code."
  - "Get Tailscale" opens the Play Store.
  - Pairing times out after 15s and restores the previous computer on failure.
- [ ] SecureStore keys: `relay-remote-computers` (`{ids,active}`), `relay-remote-computer-<key>`, legacy `relay-remote-credentials`. Keystore wait is capped at 5s. `M/src/remote/credentials.ts`, `launch-pairings.ts`, `pairing.ts`
- [ ] RemoteProvider. `M/src/remote/RemoteProvider.tsx`
  - Status is connecting, online, offline or denied.
  - On online: `overview`, then draftsOnline.
  - The cached overview shows before connecting.
  - Exposes switchTo, pair, forget (wipes offline cache, drafts, seen, icons and credentials), setRoutes, whenOnline, onMessage/onAnyMessage, `outdated`/`behind`.
  - Device name is `Platform.constants.Model`.
- [ ] MissingProjects refetches the overview when a project id is unknown. `M/src/remote/missing-projects.ts`
- [ ] ComputerSwitch: the header title shows the computer's name; tapping opens ComputerSheet (paired computers, pair another). **[verify]** `M/src/ui/ComputerSwitch.tsx`
- [ ] Last-reached time per computer is stored in AsyncStorage `relay-computers-seen`. `M/src/remote/computer-seen.ts`
- [ ] ConnectionLine shows which computer this is and whether it's reachable; it stays quiet when all is well. It appears everywhere except settings, pair, and index when narrow. `M/src/ui/ConnectionLine.tsx`

## 3. Root shell
- [ ] Provider order: RemoteProvider, then ThemeProvider, then StartupSplash (one ribbon gleam per launch), then Stack. `M/src/app/_layout.tsx`, `M/src/ui/StartupSplash.tsx`
- [ ] On launch: orientation policy, offline copies, thread notifications, latest-app checks, SystemUI background colour, confirmLaunch.
- [ ] When online: resendFailed, checkForUpdate, `reportApp`.
- [ ] Wide layout (width ≥ paneBreakpoint): a resizable, hideable Sidebar dragged by a pan gesture. AsyncStorage keys `relay-sidebar-width` and `relay-sidebar-hidden`. `M/src/ui/panes.tsx`, `M/src/ui/Sidebar.tsx`
- [ ] NeedsYou overlay: when another thread starts waiting on you, a banner appears under the header with a Warning haptic; tapping pushes that thread. Threads already waiting at launch or on computer switch don't count. `M/src/ui/NeedsYou.tsx`
- [ ] HeldWhileCovered keeps the banners' height while another screen covers them (Android inset workaround). `M/src/ui/HeldWhileCovered.tsx`
- [ ] KeyboardAware pads by the keyboard overlap (Android 15+ is edge to edge). `M/src/ui/KeyboardAware.tsx`
- [ ] Routes: index, pair, new, settings, chat/[id] (singular), chat/[id]/reply/[root], chat/[id]/agent/[agent], project/[id], turn, diff, changes, branches, commit, file, files, history, tasks.

## 4. Home and Browser
- [ ] Index. `M/src/app/index.tsx`
  - Unpaired: redirect to /pair.
  - Wide: an empty pane, "Open a thread from the list…".
  - Narrow: ComputerSwitch title, Settings2 icon to /settings, and the Browser.
- [ ] Browser. `M/src/screens/Browser.tsx`
  - Banners: ConnectionLine, ComputerUpdateBanner, UpdateBanner.
  - When denied: "Pair again".
  - Search filters threads by title and project name.
  - Segmented tabs: Activity and Projects. Pull-to-refresh. "New thread" FAB.
- [ ] Projects tab:
  - Scratchpad section with + (`/new?scratch=1`) and "Show N more" beyond 5.
  - Projects in folders, each with ProjectIcon and subtitle (working count, threads, ago), opening /project/id.
- [ ] ActivityList. `M/src/ui/ActivityList.tsx`
  - One card per open thread; threads with unsent text come first, new-thread drafts above them.
  - Snoozed and settled shelves.
  - Drafts open `/new?project&draft`.
- [ ] SwipeTriage. `M/src/ui/SwipeTriage.tsx`
  - Swipe right settles; swipe left snoozes with a preset.
  - Selection haptic when crossing the threshold; Light impact on commit.
  - Undo window afterwards.
  - Vertical intent wins; commit is judged from the actual release position, ignoring projected velocity.
  - Calls `triageProjectChat` with `undoTriage`.
- [ ] Long-press on an activity card opens a sheet: Settle, "Snooze · preset", "Mark as unread", "Copy branch name".
- [ ] ThreadRow: status, location, last-moved time; DraftLine shows the draft text tinted. `M/src/ui/ThreadRow.tsx`, `M/src/ui/DraftLine.tsx`
- [ ] Project icons. `M/src/remote/project-icons.ts`
  - Synced with `projectIcons` every 10 min (30s retry).
  - Files at `Paths.document/project-icons/<computer>/<id>-<hash>.<ext>`; AsyncStorage `relay-project-icons-by-computer`.
  - Fallback is the project's initial on a stable hue. `M/src/ui/ProjectIcon.tsx`
- [ ] Family folds are stored in AsyncStorage `relay-family-folds`. `M/src/remote/family-folds.ts`

## 5. Settings (`M/src/app/settings.tsx`)
- [ ] Theme: computer, phone, light or dark. AsyncStorage `relay-theme`.
- [ ] Notifications toggle (only when the phone can watch). If permission is denied, an Alert offers "Open settings". Keys `relay-notifications` and `relay-notifications-asked`.
- [ ] App section:
  - "Relay {runningVersion}" and its status text.
  - LatestApp rows (newest GitHub release). `M/src/ui/LatestApp.tsx`
  - "Go back to the built-in version".
- [ ] Computers: list (tap to switch), update-computer row (`updateNow`, then `computerInfo` polled every 2s, 15 min cap), "Pair another computer", "Unpair from X" (Alert, then forget). `M/src/remote/computer-update.ts`, `M/src/ui/ComputerUpdate.tsx`
- [ ] Route order: "Local network first" or "Tailscale first"; shows the current host.

## 6. New thread (`M/src/app/new.tsx`)
- [ ] Autofocused composer. WhereLine opens project and workspace sheets; RecentThreads or WhereIntro below. `M/src/ui/NewThreadWhere.tsx`
- [ ] Scratch: `createScratch` once, retried on tap.
- [ ] Settings:
  - Offline `new-thread.json` first, then `newThreadAgent`/`newThreadModels`.
  - Changing the agent saves via `saveNewThreadAgent`; changing the model via `saveNewThreadModel`.
- [ ] Send paths:
  - Held draft: `sendDraft(key, null, msg)`.
  - Otherwise `createProjectChat(where, {kind:"project"}, workspace)`, reused on retry.
  - Scheduled: `sendProjectChat` with sendAt. Otherwise outbox `deliver`.
  - Then `replace /chat/id`. `/btw` is refused.
- [ ] Draft keys: `~scratch` or `new:<project>:<ts>`. moveDraft on project change.

## 7. Thread (`M/src/screens/Thread.tsx`; routes `M/src/app/chat/[id]/index.tsx`, `reply/[root].tsx`)
- [ ] Loading. `M/src/remote/useThread.ts`
  - Offline-first, then `chat(id, known, 100, sendId)` with a known-message patch.
  - "Load N earlier" in pages of 100. Live `message` events update the list.
- [ ] Seen: `markProjectChatSeen` while focused and in front; clears the notification.
- [ ] Inverted list of MessageView. Reply variant: a thread rooted at a message (`rootId`).
- [ ] Header: CiStatusButton, then a sheet of runs (`projectCiStatus`); each run opens its URL. `M/src/ui/CiStatus.tsx`
- [ ] Thread menu (Ellipsis):
  - Rename (`renameProjectChat`).
  - Mark as done / Move back to active.
  - Snooze… / Wake up now.
  - Mark unread (then dismiss to /).
  - Regenerate title (`regenerateProjectChatTitle`).
  - Copy branch / Copy worktree.
  - Side conversations.
  - Worktree changes, Changes, Files, History.
  - Compact.
  - Archive (Alert). `M/src/ui/menu-extras.ts`
- [ ] Message long-press menu: Copy, Select text, Reply, Fork from here (`forkProjectChat`), Quote into composer, Share. `M/src/ui/SelectText.tsx`
- [ ] Above the list:
  - "Resume answer" (`resumeProjectChat`, with agent-switch confirm). `M/src/remote/agent-switch.ts`
  - Queue list via `projectChatQueueAction`: steer, remove, move. Edit pulls the item back with `projectChatQueuedImages`. `M/src/remote/taken-back.ts`
- [ ] Strips:
  - Goal.
  - Limit (`setLimitResume`).
  - Stopped (`resolveStoppedWork`).
  - Subagents (stop via `stopProjectChatAgent`; open the agent route). Polling of `subagents` backs off from 5s to 20s, 60s on failure. `M/src/remote/subagents.ts`, `M/src/ui/Subagents.tsx`
  - Waiting (`stopProjectChatPending`). Running work left behind is listed in ThreadExtras; long-press holds a row. `M/src/ui/ThreadExtras.tsx`
  - Unsent: retry, edit, "use project folder" (`selectAgentWorktree(id, null)`).
- [ ] RequestCard: approvals and questions via `respondProjectChat`, with a Light haptic on answer and a selection haptic. The ask_html page is AskPage (`relay.answer()`, Send/Skip). `M/src/ui/RequestCard.tsx`, `M/src/ui/renders/AskPage.tsx`
- [ ] AsyncQuestions:
  - `answerProjectChatQuestion` and `setProjectChatQuestionDismissed`; Light haptic. `M/src/ui/AsyncQuestions.tsx`
- [ ] WatchNotes:
  - Actions: "Learn more", "Tell {agent}", "I know this".
  - Closing a note calls `closeWatchNote`. `M/src/ui/WatchNotes.tsx`
- [ ] "Implement plan" uses remotePlanGoAhead, then deliver.
- [ ] Composer commands: changes, files, new/clear, compact (`compactProjectChat`), reload (`reloadProjectChatSession`). Stop calls `cancelProjectChat`.
- [ ] Turn haptics: the open thread buzzes Success, Error or Warning when its turn ends or it starts asking, only while focused and in front. `M/src/ui/turn-haptics.ts`
- [ ] TurnNotices: agent errors (envelope on request), a sign-in-needed note, and a note for show_html pages the phone can't draw. `M/src/ui/TurnNotices.tsx`
- [ ] StartedThreads: the threads a turn started via start_threads, live, with an "N more" fold. `M/src/ui/StartedThreads.tsx`, `M/src/remote/started-peeks.ts`

## 8. MessageView (`M/src/ui/MessageView.tsx`)
- [ ] Layout matches the desktop's ProjectChat. Shows "via {author}" and "started on its own".
- [ ] Action row:
  - Sent time, write speed, cost.
  - Copy (clipboard).
  - ReadAloud.
  - Fork into a new thread.
  - Reply.
- [ ] Divider lines for compactions and handoffs.
- [ ] Worktree setup/teardown output with "Show output" and "Run setup again" (`rerunWorktreeSetup`).
- [ ] Changed-files block:
  - Per file: +/− counts and "binary"; tapping opens the diff (kind turn).
  - "Roll back" / "Redo" for the turn.
  - Opening the turn goes to /turn.
- [ ] AgentRun: tool-call trace; expanding a call fetches `activityDetail(chat, msg, activity)`; images the turn read open from it; auto-follow is suppressed while scrolled back. `M/src/ui/AgentRun.tsx`

## 9. Composer (`M/src/ui/Composer.tsx`)
- [ ] Multiline input, placeholder "Message {agent}"; the draft is synced via useDraft/useSharedDraft.
- [ ] Toolbar:
  - Attach sheet: Photo library, Take a photo, Paste image. Max 3 images.
  - "Agent and model" chip showing model · effort · Fast; opens ModelSheet.
  - Permissions sheet; choosing full access asks "Allow full access?" in an Alert.
  - Plan toggle.
  - "/" Commands button.
  - Dictation button.
  - Steer (Medium haptic).
  - Send/Queue/Stop. Long-press Send opens the "Send later" presets.
- [ ] Image thumbnails with remove; "On computer" screenshot tiles; a clipboard "Paste" chip. `M/src/ui/clipboard-image.ts`
- [ ] Error line: tap to dismiss. A failed scheduled send retries at its original time.
- [ ] Slash and `$` menu: Relay commands, agent commands and skills via `projectCommands`. Composer commands are model, effort, fast, plan, permissions and context. `/goal` works only on Codex or Claude. `M/src/ui/CommandMenu.tsx`
- [ ] Each agent remembers its own model while you switch agents. ModelSheet: agent tabs, `agentModels`, `agentDefaults`, effort, Fast, 200k context. `M/src/ui/ModelSheet.tsx`, `M/src/remote/model-catalogs.ts`
- [ ] UsageBar and UsageSheet:
  - Thin bars for context and plan limits, plus cost.
  - `providerUsage`, polled every few minutes; refresh; Compact. `M/src/ui/Usage.tsx`
- [ ] DraftNotes: additions held on the computer, and a clash prompt "Keep this version" (`draftOther`). `M/src/ui/DraftNotes.tsx`
- [ ] Imperative handle: restore, quote (blockquote, cursor placed after it), compose (from a render page), focus/blur.

## 10. Other routes
- [ ] SubagentRun. `M/src/screens/SubagentRun.tsx`
  - Polls `subagentRun`.
  - Brief with "Show whole"; trace; report.
  - Auto-follow; "Stop agent" with confirm.
  - Read-only footer.
- [ ] Project. `M/src/app/project/[id].tsx`
  - Rows: New thread, Changes summary, Branch, Files, History, Tasks.
  - The project's threads below.
  - On focus: `projectWorkingTree` and `projectTasks`. Pull-to-refresh.
- [ ] Changes. `M/src/app/changes.tsx`
  - Staged and Working sections with stage/unstage all and per file, through `projectGitAction`.
  - Fetch, Pull, Push (confirm).
  - Commit dock:
    - `projectCommitMessage` ("Write it for me", written automatically once).
    - Message up to 16000 characters.
    - Commit, or Commit & push.
    - Blockers: an operation in progress, conflicts, no branch, over 1000 files.
- [ ] Branches: `projectBranches` lists local and remote; switching asks to confirm; "New branch from here" opens a sheet; both use `projectChangeBranch`. `M/src/app/branches.tsx`
- [ ] History: `projectHistory` in pages of 100 with "Older commits"; tapping opens /commit. Commit: `projectCommit` files open the diff (kind commit). `M/src/app/history.tsx`, `M/src/app/commit.tsx`
- [ ] Diff. `M/src/app/diff.tsx`
  - `diff(source)` for turn, working, commit or worktree.
  - Unified view with gutter and hunk headers; selectable lines.
  - Split view only when wide, stored in AsyncStorage `relay-diff-layout`.
  - Binary and truncated notes.
- [ ] Files/File: `projectFiles` tree by `dir`, search capped at 300; `projectFile` in Code with numbered lines and a first-N-lines note. `M/src/app/files.tsx`, `M/src/app/file.tsx`, `M/src/ui/Code.tsx`
- [ ] Tasks: `projectTasks` polled every 3s while focused; Restart; Stop (confirm). `M/src/app/tasks.tsx`
- [ ] Turn. `M/src/app/turn.tsx`
  - `rewindProjectTurn` per file or all, revert or redo; conflicts offer a force alert.
  - Worktree mode: `projectWorktree`, then "Merge into X".
- [ ] MergeSheet. `M/src/ui/MergeSheet.tsx`
  - `projectMergePlan`: up to 5 bases, commits, fast-forward or merge commit, push toggle.
  - `projectMergeBranch`.
  - On conflict: "Ask the agent to resolve them".

## 11. Offline cache, outbox, drafts, seen
- [ ] Offline cache. `M/src/remote/offline.ts`, `M/src/remote/offline-copies.ts`
  - `Paths.cache/relay-offline/<computer>/` holds overview.json, thread-<id>.json (20 kept, pruned by mtime), models.json and new-thread.json.
  - Writes debounced 5s; 8 threads held in memory.
  - After 3s of quiet, the 8 newest stale threads are saved ahead of time.
- [ ] Outbox. `M/src/remote/outbox.ts`, `M/src/remote/outbox-state.ts`
  - `Paths.document/relay-outbox/<sendId>.json`; restored on launch as failed or "unsure".
  - Delivers via sendProjectChat or sendDraft.
  - Resent on reconnect. `reached` checks via `chat` with sendId.
  - Shows "Not sent:" or "Maybe not sent:".
- [ ] Drafts. `M/src/remote/drafts.ts`
  - AsyncStorage `relay-drafts:<computer>`; legacy `relay-draft:*` keys migrate.
  - `saveDraft` after a pause; `draftOther` on clash; `draft` events.
  - hold, release and went states.
  - Images are kept in memory only.
- [ ] Seen state: AsyncStorage `relay-thread-seen` and `relay-thread-seen-since`; useUnread. `M/src/remote/seen.ts`

## 12. Haptics (expo-haptics)
- [ ] Steer: Medium. `Composer.tsx`
- [ ] Dictation start/stop: Light. `DictationButton.tsx`
- [ ] Swipe: selection at threshold, Light on commit. `SwipeTriage.tsx`
- [ ] NeedsYou: Warning.
- [ ] Turn end: Success, Error or Warning.
- [ ] RequestCard and AsyncQuestions: Light and selection.
- [ ] Lightbox copy: selection.

## 13. Self-update
- [ ] OTA bundle. `M/src/remote/self-update.ts`, `M/modules/relay-bundle/`
  - When the runtime matches, chunks come from `phoneAppFile(path, offset)` (512KB base64) and go through begin/append/commit with SHA-256.
  - Launch is confirmed later; if a launch never confirms, the bundle is marked failed and rolled back.
  - A native app has nothing to load as a JS bundle. You need to decide what replaces this, for example always using the APK path.
- [ ] APK. `M/src/remote/apk-install.ts`, `M/src/remote/latest-app.ts`, `M/modules/relay-apk/`
  - A different runtime means downloading the GitHub `…/v{ver}/Relay-Android.apk` with SHA-512 verification.
  - States: idle, downloading, downloaded, allow, installing, failed.
  - "Allow" resumes when the app returns; downgrades are guarded; falls back to the browser.
  - Release feed is checked every 6h (10 min retry, 20s timeout) and prefetched when unmetered.
- [ ] `reportApp(appReport)`. UpdateBanner covers the desktop's bundle, the APK the computer needs, and a newer feed APK. `M/src/ui/UpdateBanner.tsx`

## 14. Notifications and foreground service
- [ ] Foreground service. `M/src/remote/watch.ts`
  - Held for "watch" and "read".
  - Ongoing text "Connected to {name}" or "Reconnecting…".
  - Permission is asked once.
  - In the background, a chats change notifies with thread news; reading a thread clears its notice.
- [ ] Channels: `relay-threads` (HIGH) and `relay-connection` (MIN, ongoing). A tap opens `relay-remote://chat/<id>`, tagged by chatId. `M/modules/relay-watch/`
- [ ] In the JS app, a HeadlessJsTask "RelayWatch" keeps timers running in the background. A native app needs the socket to live inside the service instead.

## 15. Dictation and read-aloud
- [ ] Dictation. `M/src/remote/dictation.ts`, `M/src/ui/DictationButton.tsx`
  - `dictate` start, audio, stop, cancel.
  - 16kHz mono s16le, about 80ms chunks.
  - Phases: idle, starting, listening, finishing; a loudness value drives the waveform.
  - Tap to toggle or hold for push-to-talk.
  - Words appear live at the cursor, with tentative text muted.
  - Discard button. Ends when the app goes to the background. Stops read-aloud.
  - Gated on `overview.dictation`.
- [ ] Read-aloud. `M/src/remote/read-aloud.ts`, `M/src/ui/ReadAloudButton.tsx`
  - `readAloud` start, then pulls (at most 3s each, keeping 4s of lead), then finish or stop.
  - Holds the "read" service. Errors clear after 5s.
  - Hidden unless the computer has a voice and bridge ≥ 12.

## 16. Images and lightbox
- [ ] Picking. `M/src/remote/images.ts`
  - Library or camera, max 3, each ≤1.1MB as a data URL.
  - Resize ladder: 1600/0.8, 1280/0.7, 1024/0.6, 800/0.5.
  - Paste writes `Paths.cache/pasted-<ts>.png`.
- [ ] Loading: `image(source, max)` (bridge ≥ 14) or `projectChatImage`; `projectChatReadImage` for images the agent read. In-memory LRU of 16M characters. `M/src/ui/images/useImage.ts`, `M/src/ui/images/image-cache.ts`
- [ ] Images order: pasted, then those the answer shows, then the ones the agent read once the turn ends. `M/src/ui/images/Images.tsx`
- [ ] Lightbox. `M/src/ui/images/Lightbox.tsx`, `M/src/ui/images/lightbox-geometry.ts`
  - Pager swipe; pinch; double-tap zoom; pan while zoomed; swipe down to dismiss (a second finger turns it into a pinch).
  - Tap toggles chrome. Dots and a counter.
  - Copy image to the clipboard.

## 17. Renders
- [ ] Markdown. `M/src/ui/Markdown.tsx`
  - marked tokens drawn natively.
  - Web links open in the browser; file paths and inline code inside the thread's folder open in the app.
  - Web images stay links (so the read isn't leaked); local images are blocks.
  - Commentary uses smaller text.
- [ ] Code: highlighted by Prism by extension, numbered lines, first lines only. `M/src/ui/Code.tsx`
- [ ] Math. `M/src/ui/math/*`
  - Display formulas are KaTeX in their own WebView, with only the font subset they need; the source shows while arriving or on failure.
  - Inline math is converted to plain text where possible, else left as source.
  - Delimiters handled by `marked-math.ts`.
- [ ] HTML renders (show_html). `M/src/ui/renders/*`
  - `renderPage(chat, render, page)`, bridge ≥ 17, cached by identity along with each page's height.
  - Sandboxed WebView: no navigation; links are posted to the app; it reports its own height.
  - `relay.compose()` writes into the composer; the theme is passed as CSS variables.

## 18. Theming and UI kit
- [ ] Desktop palette per mode, the waiting colour and the `mix` helper. ThemeProvider: computer, phone, light or dark. `M/src/ui/theme.ts`, `M/src/ui/ThemeProvider.tsx`
- [ ] Sheet. `M/src/ui/Sheet.tsx`
  - Drag by the grip, or by the content once it's scrolled to the top.
  - Closes past a third of its height or on a fling.
  - On a wide screen it's a centred card.
- [ ] Shine (animated label sweep) and motion (animations run only in the foreground; tickers). `M/src/ui/Shine.tsx`, `M/src/ui/motion.ts`
- [ ] Rows, Button, ProviderIcon, ScreenFailed, failure. **[verify]** `M/src/ui/Rows.tsx`, `M/src/ui/failure.ts`

## 19. Config, permissions and plugins
- [ ] Scheme `relay-remote`; package `dev.relay.remote`. `M/app.json`
  - Deep links: `pair?…` and `chat/<id>`.
- [ ] Android:
  - softwareKeyboardLayoutMode resize; predictive back off; cleartext traffic allowed.
  - Splash and background colour #1e1e21.
  - Adaptive and monochrome icons.
- [ ] Version from RELAY_VERSION, versionCode from RELAY_VERSION_CODE, `extra.relayRuntime` from RELAY_RUNTIME. `M/app.config.js`
- [ ] Release signing from env vars, falling back to the debug key. `M/plugins/release-signing.js`
- [ ] configChanges includes `density`, so foldables don't recreate the activity. `M/plugins/fold-config-changes.js`
- [ ] Permissions:
  - CAMERA
  - RECORD_AUDIO
  - POST_NOTIFICATIONS
  - FOREGROUND_SERVICE, plus types REMOTE_MESSAGING and MEDIA_PLAYBACK
  - REQUEST_INSTALL_PACKAGES
  - ACCESS_NETWORK_STATE
  - INTERNET

## 20. Native modules (what to port)
- [ ] relay-apk. `M/modules/relay-apk/`
  - Checks and opens the install-unknown-apps setting; reports metered network.
  - Download with progress and SHA-512 into `cacheDir/apk`.
  - PackageInstaller session with InstallReceiver: results are installed, cancelled, or error (conflict/incompatible).
  - Deletes the stale APK once it's installed.
- [ ] relay-bundle: stores, verifies and rolls back OTA JS bundles in SharedPreferences "relay-bundle". Not needed natively. `M/modules/relay-bundle/`
- [ ] relay-mic: AudioRecord, VOICE_RECOGNITION source, PCM chunks plus power. `M/modules/relay-mic/`
- [ ] relay-speaker: streaming AudioTrack for speech (start, write returns seconds queued, ahead, finish, stop). `M/modules/relay-speaker/`
- [ ] relay-watch: foreground service, two channels, thread notifications by tag, headless task. `M/modules/relay-watch/`