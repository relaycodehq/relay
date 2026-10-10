# Adding an agent adapter

An adapter translates an agent's protocol into Relay's `AgentRuntime`. Relay
owns threads, queues, saved messages and UI; the adapter owns communication
with the agent and its native sessions. Start with
[`electron/agents/types.ts`](../electron/agents/types.ts) and the runtime
registry in [`electron/agents/index.ts`](../electron/agents/index.ts).

## Choose the integration route

- **ACP registry agent:** install it through Settings → Agents → More agents.
  Relay creates an `acp:<registry-id>` provider and runtime dynamically; no
  new built-in adapter is needed.
- **Built-in ACP agent:** add an `AcpProfile` in
  `electron/agents/acp/profiles.ts`, extend `AcpProvider` and `acpProfiles`, and
  register `acpRuntime(provider)`. The profile supplies startup, authentication
  and permission-mode mapping; reuse the ACP transport, catalog and turn runner.
- **Different protocol or SDK:** implement it in `electron/agents/<agent>/`
  and register an `AgentRuntime`. OpenCode demonstrates HTTP/event streaming;
  Cursor demonstrates an SDK in a worker. Keep native parsing and policy here.

## How it fits together

Desktop and phone send the shared project-chat request. Services in
`electron/project-chats/` manage queues and turn state. `turn-run.ts` builds
`AgentOptions`, calls `agentRuntime(provider).run(options)` and records the
callbacks into messages. The adapter translates native events into Relay's
shared message/activity types, which both clients display.

Catalogs use the same boundary: `electron/api/projects.ts` calls `models()`,
`defaults(root)` and `commands(root)`. The desktop's
`src/features/agents/useAgentPicks.ts` already loads catalogs for new providers.

## The runtime contract

Required methods are `run(options): Promise<string>`, `closeSession(key)`,
`models()`, `defaults(root)` and `commands(root)`. Empty commands or `null`
defaults are valid when the agent offers none.

- **Output:** `onText` receives the whole answer so far, not a delta; `run`
  returns the final answer. Keep commentary separate through `onCommentary`.
  Use stable activity IDs for tool updates, `onEdit` for written paths,
  `onContext` for context size and `onUsage` for per-request tokens. Register
  with `counted(provider, runtime)` for shared usage accounting. Enforce
  `answerLimitError` from `turn-kit.ts`.
- **Inputs and policy:** honor `cwd`, worktree `env`, linked-folder access,
  model choice, images and private `context()`. Connect `relayTools` as an
  authenticated MCP server where supported. Map runtime/plan modes to actual
  agent policy and route approvals/questions through `onRequest`. Enforce
  read-only and helper restrictions through tool permissions, not just prompts.
- **Control and failures:** cancel native work on `signal`; clean up listeners
  and pending requests. Expose steering through `onControl` when supported and
  acknowledge consumed messages through `onSteered`. Use `signedOutError` and
  `usageLimitError` from `electron/agents/errors.ts` for actionable failures.
  Reject unsupported `AgentJob` kinds explicitly.

## Sessions and restarts

`session.key` identifies the live session slot; `session.id` is the native
conversation ID. Await `session.onId(id)` when creating or replacing one.
Relay persists conversations per provider in `chat.sessions`, managed by
`electron/project-chats/sessions.ts`; do not introduce another chat store.
Publish `onPoint` if native forks are supported.

For processes that survive a Relay restart, reuse `HostedSessions` in
`electron/agents/hosted-sessions.ts` and `electron/agent-host/`. Implement
`detach` to leave hosted work running, `reattach` to reclaim owned sessions,
and the `adopt` job to observe an in-flight turn without resending its prompt.
`dispose` ends work on quit; `closeSession` releases live resources without
deleting conversation history. OpenCode instead hosts one server with
agent-owned persistent sessions; follow the lifecycle that fits the protocol.

## Register and expose it

For a new built-in provider:

1. Add its ID and truthful `AgentInfo` capabilities in `shared/agents.ts`.
   These drive helper, review and side-question eligibility. Enable `side`
   only with contextual answering or a working conversation fork; `usage`
   means subscription-limit meters, separate from token accounting.
2. Add its counted runtime in `electron/agents/index.ts`. Wire CLI discovery
   through `electron/platform/executables.ts` and install/update metadata in
   `electron/agents/agent-updates.ts`, or SDK setup and `signIn`/`signOut` hooks.
   Describe permission limitations in `shared/agent-modes.ts`.
3. Add branding in `src/features/agents/ComposerModelPicker.tsx`,
   `src/features/agents/ProviderLogos.tsx` and `mobile/src/ui/ProviderIcon.tsx`.
   Check existing catalog/settings paths before adding provider-specific IPC.
4. For a new worker, declare its bundle in `scripts/electron-bundles.mjs`,
   include it in `scripts/build-headless.mjs`, and check `package.json`'s
   `asarUnpack`. Headless uses plain Node; new Electron calls need support in
   `electron/headless/electron-stand-in.ts`.

Keep shared contracts free of Node/DOM APIs, backend code in `electron/`, and
desktop UI in its feature folder.

## Previous additions and validation

- `b1945b38` — **OpenCode:** introduced `AgentRuntime`, the common registry
  and per-provider sessions, with a fake HTTP server and composer E2E test.
- `8b9f060b` — **Cursor:** reused the contract, adding a worker, verified SDK
  download, account/update support, permission policy and protocol fixtures.
- `472d880c` — **ACP:** added one runtime with profiles for Amp and Antigravity,
  plus dynamic registry providers. Start here for another ACP agent.

Read these with `git show <commit>`; historical paths may predate today's layout.

Test with a fake peer like `tests/fixtures/acp-agent.cjs`,
`tests/fixtures/opencode-server.cjs` or `tests/fixtures/cursor-sdk.mjs`. Cover
streaming, session resume, cancellation, denied tools, malformed events and
supported jobs. For hosted work, check restart/reattach without duplicate
prompts. Add a composer flow like `tests/e2e/opencode.spec.ts` or
`tests/e2e/cursor.spec.ts` to prove selection, sending and continuation.

Run focused adapter tests, `npm run typecheck`,
`npm test -- tests/unit/layout.test.ts` and `npm run build:headless`; build the
desktop and run relevant E2E specs when its wiring changes. Fake agents do not
verify real authentication or platform sandboxing: report which real-agent
flows and operating systems you checked.
