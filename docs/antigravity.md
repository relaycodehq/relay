# Antigravity in Relay

Relay downloads Google's official ACP server. The shared ACP transport owns
connections, sessions, cancellation and streaming; provider-specific behavior
lives in `electron/agents/antigravity/`.

## Model discovery

Antigravity ACP 1.4.1 filters out non-Gemini models unless the ACP client's
name is on Google's hardcoded allowlist. Relay sends `clientInfo.name: "zed"`
only to Antigravity so its catalog includes the account's available Claude
and GPT models. The client title remains Relay. Remove this compatibility
identity when Google supports Relay or a capability-based opt-in.

Antigravity's client-name gate is retarded. This is a brittle client-name
gate, not capability negotiation. The server
hides working models from unrecognized clients, then misleadingly rejects
explicit selection as unavailable for the current authentication method.
Changing only the client name unlocks them with the same account and server.

Live probes of the same server and account confirmed that `relay` received
only Gemini and could not select Claude/GPT, while `zed` received those models
and completed small prompts with Claude Sonnet 4.6 and GPT-OSS 120B. Model
availability still depends on the signed-in account.

## Supported workflows

- Native fixed-choice questions use Relay's question cards, including in Full
  access. Their choices retain the server's IDs, and arbitrary answers are
  disabled on desktop, iPhone and Android.
- Plan mode sends the native `/plan` workflow. Live checklist updates are
  reflected as they arrive, and the final proposal uses Relay's plan UI.
- Manual compaction summarizes the existing conversation and seeds a new
  native session. The replacement ID is published only after seeding succeeds.
  Original native history and Relay's transcript are retained; a failed or
  cancelled replacement leaves the original ID selected. This does not rely
  on a model interpreting an unadvertised `/compact` prompt as an operation.
- Native subagent batches appear in Relay's agent UI. ACP does not provide
  individual child IDs or cancellation: batches have an explicit unknown-child
  status and no individual Stop action.
- Helper jobs run in a temporary workspace without Relay's MCP tools. Native
  permission requests are denied and attempted tool activity fails the job.
  Profiles with global hooks or MCP servers are refused before startup, since
  those can execute before a permission callback. Helpers have a three-minute
  deadline and remove their own temporary history when its metadata proves
  ownership. Relay's normal helper fallback can choose another provider.

## Accounts

The default account keeps the existing `GEMINI_HOME` (normally `~/.gemini`)
and its original file/Keychain storage. Extra accounts use private profiles
under Relay's `agent-accounts/antigravity/<id>`, with file-based Google
credentials so they never share Google's global Keychain item.

Profiles share native conversation history, brain artifacts and user tooling;
they never link the default account's token or authentication settings.
Ambient Google credentials are removed from extra accounts' process
environments. Threads pin their chosen account. A changed account or
credential revision restarts the native process on the saved conversation,
and invalidates its model catalog.

## Quotas

The provider-specific quota reader exchanges the saved Google refresh token
for a short-lived access token, and reads quota summaries from Google's
Cloud Code services. Gemini and the shared Claude/GPT pool retain separate
labels, percentages and reset times. The ring shows the most restrictive
reading for each cadence; its popup lists every reported pool.

Only reported five-hour and weekly windows are shown. Missing information is
unavailable, not zero usage or a guessed reset time. The Refresh controls
recheck the credential source after an external sign-in.

A bearer-token refusal invalidates only that reader's rejected access token
and allows one read retry. Late failures cannot clear a newer login's token.
Network failures, permission failures, rate limits and server errors do not
sign out an account. Saved Google credentials and API keys are never deleted
by usage checks.

## Protocol limits and verification

The installed 1.4.1 server advertised session load/resume, image/audio input,
HTTP/SSE MCP, and the `plan`, `logout` and `usage` commands during a live
probe. It did not advertise session forks, steering, side questions or goals;
Relay does not pretend those features work through this server.

Fixture integration tests cover account isolation, cancellation, compaction
transactions, native choice responses, subagent batches and auth recovery.
`tests/e2e/antigravity.spec.ts` checks the desktop's actual question, quota,
compaction, planning and account flows. Phone model tests cover the shared
choice IDs, quota labels and batch restrictions.
