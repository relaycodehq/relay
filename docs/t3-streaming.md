# Updating T3 streaming

Relay uses actual T3 Code source for the Codex JSON-RPC transport and
incremental Markdown parser. T3's package is private to its monorepo, so these
small modules are vendored unchanged rather than pretending there is a published
SDK dependency. `t3-streaming.lock.json` records the upstream commit, file hashes,
and exact Effect runtime version. The app remains usable without contacting GitHub.

## Update procedure

1. `npm run vendor:t3:check` compares the pinned files with upstream main, without
   changing anything. It prints the candidate commit and changed files.
2. Inspect the upstream changes. Run
   `npm run vendor:t3:update -- --ref FULL_COMMIT_SHA` to copy that exact revision.
   This refuses local edits, unknown dependency layouts, and mismatched Effect
   versions. If the dependency changed, install the printed exact version first.
3. Run `npm run test:streaming` and `npm run build`. Review the diff, including the
   lock and dependency updates. Commit the source, lock and dependency changes
   together. Git provides rollback to the previous known-good version.

The updater downloads every file before replacing anything, restores originals
on write failure, and never executes upstream code. A deliberately explicit
update avoids shipping a moving main branch into users' desktop apps.

## Boundaries

Do not edit `src/vendor/t3code/markdown-incremental.ts` or
`electron/vendor/t3code/**`. Formatting ignores them; tests verify their hashes.

- `electron/agents/codex/codex-transport.ts`: adapts Node subprocess streams to T3's
  protocol; enforces response size limits and request timeouts. Native approval and question requests pass to the local request broker.
- `electron/agents/codex/codex-connection.ts`: keeps the native process alive between turns so native session approval rules survive. Stop and app disposal close it.
- `electron/agents/codex/codex.ts`: executable lookup, permissions, model settings,
  session resume, cancellation, and normalized text updates.
- `electron/project-chats/index.ts`: local history, restart recovery, coalesced IPC
  delivery and persistence. These are Relay responsibilities.
- `src/ui/ui.tsx`: one incremental parser cache per Markdown renderer.
  Raw HTML and remote image fetching remain disabled.

The tests exercise fragmented Unicode, request correlation, malformed and oversized
frames, provider approval rejection, cancellation, duplicate final messages,
restart/session resume, selected model settings, and incremental Markdown output
against ordinary parsing at every character. They use local fixtures, no tokens,
no provider billing and no visible desktop windows.

Upstream updates may change APIs. The adapter may then need a small adjustment;
this setup makes that visible and testable rather than promising zero maintenance.

## Permission and planning adapters

The runtime mode labels, descriptions, icons, Codex policy mapping and Build/Plan toggle follow `runtimeModeConfig.ts`, `ComposerFooterModeControls`, and `CodexSessionRuntime.ts` at the pinned T3 reference commit. Approval actions and numbered planning choices follow `ComposerPendingApprovalActions.tsx` and `ComposerPendingUserInputPanel.tsx`. These app adapters are not pristine vendor files and should be compared during an upstream update.

Claude project turns use the pinned official `@anthropic-ai/claude-agent-sdk` (the same API used by T3’s `ClaudeAdapter`) for native permission callbacks, streamed images/text, questions, and session resume. It is bundled as a separate ESM module for Electron. Update its pinned dependency and validate callbacks plus the packaged-runtime smoke test when upgrading. The legacy review/title path still uses a restricted CLI invocation.
