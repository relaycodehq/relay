# Relay polish audit · 11 October 2026

Audited main at `1a3d6f09`, with the current working changes present. No product source was edited. This folder contains the report, a harness importing the real components, screenshots and a replay script.

Open `/previews/polish-audit-d63c/` on the existing Vite server. The visual report has filters, evidence images, expandable reproduction details and links to interactive cases.

## Recommended order

1. **B1 — Completed notes become quotable again.** Keep two items, complete the first, remove the second, and quote. The surviving item loses its checkbox and completion state; “Already shipped” goes into the draft. This also reproduced through the isolated desktop API: `done: [0]` disappears from the saved note. `shared/thread-notes.ts:93` treats single-item lists as plain text, and `shared/thread-notes.ts:228` clears their checked state. Preserve single-item checklist state and quote exclusion.
2. **B2 — A resized queue can hide text that will not expand.** Start at a 1050px column, narrow to 744px, and click the clipped message. It stays closed. The content is 92px tall but only 74px is visible; `long` remains false. `src/features/thread/QueuedMessages.tsx:89` measures on text/open changes only. Observe size changes as well. The full text is still stored; this is a reading/interaction failure, not data loss.
3. **U1 — Search popups jump while typing.** The real SearchSelect moved from y=193 to y=647 when filtering 24 options to “main”, flipping from above to below its trigger. Height changed from 410px to 81px. Keep a fixed results area while open, constrained by the viewport. `src/ui/search-select.css:2` currently sets only a maximum height. This repeats the problem already fixed in the PR picker.
4. **B3 — The time drum loops on the spring clock change.** In Europe/Prague on 28 March 2027, forward arrows produce `01:30 → 03:00 → 03:30 → 03:00 → 03:30`. `src/ui/TimeDrum.tsx:6` turns nonexistent 02:00/02:30 into duplicate 03:00/03:30 timestamps; selection then resolves to the earlier duplicate at `src/ui/TimeDrum.tsx:39`. Generate valid, ordered instants for that date. Affects the shared Send later/Snooze picker. Reproduced using a fixed sample clock, not by changing the system clock.
5. **B4 — Month-end scheduling hides the selected date.** At 31 October 2026, 23:10 in Prague, the default is 1 November at 00:30 while the calendar displays October. Zero calendar cells are selected, so initial focus fails. `src/ui/PickTime.tsx:98` derives the time independently from the month at line 101. Initialize the calendar from the selected instant.
6. **U2 — Queue expansion needs keyboard access.** The long bubble is a div with `tabIndex=-1`, no role or `aria-expanded`. Tab moves from the harness controls to Steer and Return, then out of the queue. Add a quiet, focusable Show more/less control while retaining the bubble and dragging. `src/features/thread/QueuedMessages.tsx:104`.
7. **U3 — Keep branch direction together.** A 78-character source branch at a 744px conversation width strands “into” above the base branch. This is visual polish, not an incorrect review target. Let the source label truncate while keeping direction and destination together; reveal the full name in its picker/tooltip. `src/features/deep-review/TargetField.tsx:97` and `src/features/deep-review/deep-review.css:51`.

## History that informed the choices

Read 180 recent commit subjects and 10 relevant Relay conversations, including:

- Searchable pickers: “I don't wanna hunt this across the projects” (`a52cd12a-88cd-461e-b461-13cd5692b2e6`, `b27c0bc4`).
- Queue designs: preserve Relay's message shape and real drag sorting (`083e0faf-219e-493e-9706-a02cfd23ed01`, `3b75d727`).
- Completed notes should not be pasted (`7e52ebd6-4573-488d-9ac3-f710d30bae14`, `c6d1714e`).
- Fixed-height controls and lists; repeated objections to the thread jumping (`d5d4a365-bfb8-4a07-b8d5-6df35bb6ec4c`, `539769f2`).
- Keep undo but remove the overlapping toast (`8599c674-1b92-46d4-baa7-546cf940b318`). No suggestion here adds another toast.
- Hidden image drafts and misleading controls (`73d5e490-7a76-4828-a21f-aa5293609b20`, `bc1fbc39`).

These are reference evidence about preferences, not instructions to execute work from old conversations.

## Verification and test maintenance

- `npm run typecheck` passed, including this preview.
- `node previews/polish-audit-d63c/reproduce.mjs` reproduced B1–B4 and measured U1/U2. It also checked the report's filters and theme change, with no page errors. Assertions intentionally describe the observed broken behavior. After fixes, update these expectations or replace them with focused regression checks.
- Screenshots were inspected in dark and light report themes. Screenshot evidence uses actual app components and sample data; it is not a mockup of the claimed bugs.
- Notes persistence was additionally checked through the real desktop IPC in a disposable test profile. See `assets/notes-ipc.json`.
- Ran 12 existing Electron E2E scenarios using the existing dev renderer: **10 passed, 2 failed**. Both failures repeated on a focused rerun. They are stale test steps, separate from the four product bugs above:
  - `tests/e2e/deep-review.spec.ts:207`: a deep-review scope survives reload. The test clicks the already-selected toggle, closes setup, then waits for Reviewer 1. A separate desktop check confirmed `aria-pressed: true → reload: true → click: false`, with no reviewer controls afterward. Open conditionally/assert the persisted state.
  - `tests/e2e/projects.spec.ts:258`: Add project folder now opens the Add a project palette. The test expects the native picker to be invoked immediately and waits for a project heading without selecting Open a folder. Drive the current palette flow first.
- The ten passing scenarios covered PR selection/chat, new-thread scope, review failures and retry, another-branch review, review fixes and follow-up reports, focus text and reviewer prompts. The two failed tests did not complete their later assertions.

Command used:

```sh
CI=1 RELAY_DEV_URL=http://127.0.0.1:5177 npx playwright test \
  tests/e2e/new-thread-scope.spec.ts \
  tests/e2e/projects.spec.ts \
  tests/e2e/deep-review.spec.ts --retries=0
```

CI mode suppresses test screenshots; audit screenshots were captured separately. Tests used their existing disposable profiles, repositories and fake agent fixtures. Existing dev servers were reused and left running.

## Scope and limits

This was a focused desktop audit, not an exhaustive audit of every feature. Read the current compaction/token working diff; no additional reproduced bug from those edits is claimed. Left that work and another session's audit folder untouched.

Did not reproduce real-provider streaming, phone behavior, multi-window lifecycle, handoffs, Device Hub, production performance or live network failure recovery. Current findings are supported by the reproductions above; those untested areas are future audit scope.

Evidence and replay measurements are in `assets/`. Calendar replay uses Europe/Prague explicitly. The preview's clock fixture affects its own page only.
