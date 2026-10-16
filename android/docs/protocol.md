# Relay phone ↔ desktop bridge protocol spec (for a native Kotlin client)

ROOT = `/Users/lubomirmolin/Library/Application Support/Relay Experimental/worktrees/relay/kotlin-phone`. This is the worktree I was moved to; it has the same tree as `/Users/lubomirmolin/PhpstormProjects/relay`. All paths below are relative to ROOT.

**Corrections to the brief, checked against the code:**
- **No relay server, rendezvous service or HTTP transport exists.** The only transport is a direct `ws://` WebSocket to the desktop over a local-network or Tailscale address.
- **`relay-watch` is not a network component.** `mobile/modules/relay-watch` is only an Android foreground service plus notifications. It keeps the JS client alive in the background.
- **"bridge 19" is `draftsBridge`.** The current bridge version is **22**. The "bridge 14 patches" are `compactBridge`.

Core files: `shared/remote.ts` (types and constants), `shared/remote-crypto.ts`, `shared/remote-wire.ts`, `shared/remote-delta.ts`, `shared/remote-routes.ts`, `shared/remote-client.ts` (the phone client, with no React Native in it). Desktop side: `electron/remote/server.ts`, `bridge.ts`, `link-sender.ts`, `devices.ts`, `phone-remote.ts`, `lan.ts`, `tailscale.ts`.

---

## 1. Pairing

### QR payload (`shared/remote.ts:47-93`)
- Format: `relay-remote://pair?h=<hosts comma-joined>&p=<port>&k=<key>&c=<code>&n=<name>`, built with `URLSearchParams` (form encoding).
- The parser finds the query with `/[/:]pair\?(.+)$/`, so wrapped URLs such as `exp://…/--/pair?…` also work.
- Validation:
  - `h`: split on `,` and filtered by `validHost`, which is `/^[A-Za-z0-9.-]{1,253}$/` or `/^\[[0-9a-fA-F:]+\]$/`. At least one host must remain.
  - `p`: an integer from 1 to 65535. The default port is `defaultRemotePort = 47821` (`:40`).
  - `k`: `/^[A-Za-z0-9_-]{43}$/`. This is the desktop's **static X25519 public key**, 32 bytes as unpadded base64url.
  - `c`: `/^[A-Za-z0-9_-]{16,64}$/`. The desktop generates `randomToken(24)`, which is 32 chars (`electron/remote/devices.ts:91`).
  - `n`: cut to 80 chars; defaults to `"Relay"`.

### Desktop side (`electron/remote/devices.ts`)
- The static key pair is created once and persisted, sealed by the OS (`:71-87`).
- A code expires after 10 min (`pairingMs`, `:17`).
- Codes are compared in constant time. After 5 wrong guesses the code is killed (`:19`, `:101-103`).
- At most 10 devices can be paired (`:18`).
- On a successful `pair`:
  - `deviceId = randomUUID()`.
  - `token = randomToken(32)`, 43 base64url chars.
  - The desktop stores only `sha256(token)` as base64url (`:21-22`, `:108-127`).
  - The device name has control chars stripped and is cut to 60 chars.
- The QR URL is built in `electron/remote/phone-remote.ts:276-292`.

### Key exchange
There is no separate pairing crypto. Pairing runs the normal Noise-NK-like handshake (§3) pinned to `k`, then sends a `pair` frame carrying the code. The desktop answers `paired` with `deviceId`, `token`, `name`, `bridge` and `hosts`.

### What the phone stores (`mobile/src/remote/credentials.ts`)
Everything is in `expo-secure-store` (Android Keystore-backed):

| Key | Contents |
|---|---|
| `relay-remote-computers` | `{ ids: string[] /* pairing order, oldest first */, active?: string }` |
| `relay-remote-computer-<id>` | `RemoteCredentials` JSON, one per computer |
| `relay-remote-credentials` | Legacy single record; it mirrors the active one (`:35-41`) and is migrated in `loadPaired` (`:46-55`) |

- Each id is the desktop's public key `k`.
- `RemoteCredentials` (`shared/remote.ts:96-105`): `{hosts: string[], port: number, key: string, name: string, deviceId: string, token: string, routes?: ("local"|"tailscale")[]}`.

### Multi-computer behaviour (`mobile/src/remote/RemoteProvider.tsx`)
- One live client at a time (`:119`, `:144-216`).
- `pair()` waits up to 15 s (`pairingTimeout`, `:120`) for that client to come online. Otherwise it reverts to the previous computer (`:411-438`).
- `PendingPairing` (`mobile/src/remote/pairing.ts`) settles only on the client that started the pairing.
- The device name sent is `Platform.constants.Model`, or "Android phone" if unknown (`:107-112`).
- Launch reads the keystore with a 5 s cap (`mobile/src/remote/launch-pairings.ts:2`).

---

## 2. Transport

### URL and socket settings
- URL: `ws://<host>:<port>/`. A bare IPv6 host gets brackets (`shared/remote-client.ts:434`).
- `binaryType = "arraybuffer"`.
- Desktop server (`electron/remote/server.ts`):
  - `perMessageDeflate: false` and `maxPayload: 8 MiB` (`:133-134`).
  - Binds to `0.0.0.0` when local network is allowed, otherwise to the first Tailscale IPv4 (`phone-remote.ts:322-344`). It re-syncs every 10 s.

### Peer filter (`server.ts:153-155`)
The desktop accepts:
- Tailscale peers: `100.64.0.0/10`, `fd7a:115c:a1e0:` prefix, or `127.0.0.1` / `::1` (`tailscale.ts:16-28`).
- With local network on, also LAN peers: 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, `fc`/`fd`/`fe8-b` prefixes, `::1` (`lan.ts:21-28`).

### Desktop limits
- 24 connections in total (`server.ts:55`).
- 4 unauthenticated sockets per address; the oldest idle one is evicted (`makeRoom`, `:72-88`).
- 10 s to finish the handshake (`:54`).

### Route classification and ordering (`shared/remote-routes.ts`)
- `routeKind`:
  - `tailscale`: 100.64–127.x, `fd7a:115c:a1e0:` prefix, or a name ending in `.ts.net`.
  - Everything else is `local`.
- Default order is `["local","tailscale"]`. Hosts are sorted stably by route rank (`orderHosts`).
- At most 8 hosts are kept (`maxHosts`).
- `learnHosts(fresh, via)` = de-duplicated `[...fresh.slice(0,7), via]`.

### Dialing (`shared/remote-client.ts`)
- Hosts are raced in order with a **1500 ms stagger** (`:262`). A failed dial launches the next one immediately.
- When pairing, the first socket whose channel opens claims the sign-in, and the other dials are cancelled. This ensures the one-time code is sent once (`:280-293`).
- Per-dial timeout is 15 s (`:454-457`).
- A `denied` reply stops every route and sets status `denied` permanently (`:309`, `:506`).

### Reconnect and backoff
- Delay is `min(15000, 1000·2^retry)` ms (`:325-329`). The counter resets when a connection comes online (`:360`).
- `wake()` (app returns to foreground) reconnects at once if offline, or if online but nothing was heard for more than `staleMs/2` = 20 s (`:142-157`).

### Better-route probing
- While on a later route, every 60 s (`:370-373`) the client dials the earlier hosts beside the live link.
- It swaps only when no calls are in flight (`:389-416`).
- Hosts that lost are cooled for 5 min (`:376-383`).

### Heartbeats
- The desktop runs a 15 s interval (`server.ts:161`, `tick()` `:326-337`):
  - a WebSocket-level `ping`; a socket that hasn't ponged since the last tick is terminated;
  - plus a sealed `{t:"tick", hosts}` to signed-in devices.
- The phone's watchdog is **40 s** from the last frame received (`staleMs`, `remote-client.ts:604-612`). Any opened frame resets it.
- When `tick.hosts` differs from the saved hosts, the phone updates its credentials and re-probes routes (`:541-555`).

---

## 3. Crypto framing (`shared/remote-crypto.ts`)

The code uses noble with no fixed test vectors.

### Hello (plaintext, one each way, as a WebSocket **text** frame)
- Format: `{"t":"hello","v":1,"e":"<base64url(32-byte X25519 ephemeral pub)>"}`. `v` = `remoteProtocol = 1` (`shared/remote.ts:38`).
- The phone sends its hello on `onopen`. The desktop replies with its own hello.
- Validation (`:123-129`): `t=="hello"`, `v==1`, and the decoded key is exactly 32 bytes.

### Diffie-Hellman
- Curve: X25519, with RFC 7748 clamping from noble.
- An all-zero shared secret is rejected (`:110-115`).
- Phone (client):
  - `es = X25519(clientEph.secret, serverStatic)`
  - `ee = X25519(clientEph.secret, serverEph)`
- Desktop computes the mirrors: `X25519(static.secret, clientEph)` and `X25519(eph.secret, clientEph)`.

### Key derivation (`:93-108`)
```
okm = HKDF-SHA256(
  IKM  = es || ee                                       (64 bytes)
  salt = UTF-8 "relay-remote/1"                         (14 bytes)
  info = serverStatic || clientEphemeral || serverEphemeral   (96 bytes, raw pubkeys)
  L    = 64)
toServer = okm[0..32), toClient = okm[32..64)
```
- Phone: sendKey = toServer, receiveKey = toClient. The desktop uses the reverse.

### Cipher
- **ChaCha20-Poly1305 IETF (RFC 8439)**, 32-byte key, **no AAD**.
- Output is ciphertext followed by a 16-byte tag (noble layout; equivalent to JCA/BouncyCastle `ChaCha20-Poly1305` output).

### Nonce (`:132-138`)
- 12 bytes: `00 00 00 00` followed by a **64-bit big-endian counter**.
- There is a separate counter per direction. Both start at 0 after the hello; the first sealed frame (`pair`/`auth`) uses 0.
- Strictly sequential, so a dropped, reordered or replayed frame fails authentication. That is the only replay protection; fresh ephemerals stop cross-session replay.
- `received++` happens only after a successful decrypt.

### Base64url
- RFC 4648 URL alphabet, **no padding**.
- Decoding rejects any other character and lengths with `len % 4 == 1` (`:169-209`).
- `randomToken(n)` = base64url of n random bytes.

### Envelope (`shared/remote-wire.ts`)

**Text mode** (before compact, and always for `pair`/`auth`/`paired`/`ready`):
- WebSocket text frame = `base64url( seal( UTF-8(JSON) ) )`.

**Binary mode** (both ends at bridge ≥ 14):
- WebSocket binary frame = `seal( flag(1 byte) || body )`.
  - `flag 0x00`: body is UTF-8 JSON.
  - `flag 0x01`: body is **raw DEFLATE** (no zlib header) of the UTF-8 JSON. The phone uses fflate level 6; the desktop uses `deflateRawSync` level 6.
  - `flag 0x02` (bridge ≥ 23): a port tunnel frame, bytes rather than JSON; see "Port tunnel" in section 5.
- Deflate is used only when `256 ≤ jsonBytes ≤ deflateUpTo` and the result is smaller. `deflateUpTo` is 1 MiB on the phone (`:25-35`) and unlimited on the desktop (`server.ts:90-96`).
- The desktop caps inflate output at 32 MiB.
- Any other flag throws "Unknown frame".
- Receivers accept text frames even on a compact link (`openFrame` branches on frame type).

### Compact switch-over (who sends what)
- The phone sends `pair`/`auth` as **text**, always (`remote-client.ts:481-498`, `compact=false`).
- The desktop answers `paired`/`ready` as **text**. Its `LinkSender` is created only after that send (`server.ts:284-287`).
- After that:
  - The **desktop** sends binary when the *phone's* declared `bridge ≥ 14`.
  - The **phone** sends binary when the *desktop's* `bridge` in `paired`/`ready` is ≥ 14 (`remote-client.ts:613-618`).
- **Pitfall:** the desktop **terminates** a client that sends a binary frame before its link is set up (`server.ts:219`).
- An undecryptable frame:
  - while dialing → "Couldn't verify … Pair again." (`remote-client.ts:521-523`);
  - after sign-in → the phone closes the socket; the desktop terminates on any open failure (`server.ts:240-243`).

---

## 4. Version negotiation and handshake messages (`shared/remote.ts:168-241`, `:723-761`)

### Current bridge version and feature thresholds
`remoteBridgeVersion = 22`. Features switch on at these bridge versions:

| Bridge | Constant(s) | What it enables |
|---|---|---|
| 11 | `recipientBridge`, `handoffBridge`, `phoneUpdatesBridge` | Send `to` field; phones may call `computerInfo` and `updateNow` |
| 12 | `readAloudBridge` | `readAloud` |
| 13 | `activityDetailBridge` (`phoneDetailPreview = 600`), `awayBridge` | `activityDetail`; `startedBy`, `limitResume`, `setLimitResume`, `closeWatchNote` |
| 14 | `imageBridge`, **`compactBridge`** | `image`; binary frames, patches and `got` acks |
| 15 | `subagentsBridge`, `titleBridge`, `markedUnreadBridge` | Subagents; title regeneration; manual unread marks |
| 16 | `workspaceBridge` | `selectAgentWorktree` |
| 17 | `renderBridge` | `renderPage` |
| 18 | `liveHandoffBridge` | Live handoffs |
| 19 | `draftsBridge` | Shared drafts |
| 20 | `folderHandoffBridge`, `startHandoffBridge` | Handoff folder methods and start |
| 21 | `skillsBridge` | `skills` field in a send |
| 22 | `previewBridge`, `notesBridge`, `workspaceMovesBridge` | `image` with `{kind:"preview"}`; `notesMark` on summaries and `threadNotes` / `tickThreadNote` / `removeThreadNote`; `workspaceMoves` on a thread |

### ClientFrame (phone → desktop)
- `{t:"pair", code, device, kind?:"computer", bridge?}`. Phones omit `kind`.
- `{t:"auth", deviceId, token, bridge?}`.
- `{t:"call", id:number /* safe int, starts at 1 */, method, args:unknown[] /* ≤4 */}`.
- `{t:"got", s:number}`.

### ServerFrame (desktop → phone)
- `{t:"paired", deviceId, token, name, bridge?, hosts?}` and `{t:"ready", name, bridge?, hosts?}`.
- `{t:"denied", reason}`.
- `{t:"result", id, ok:true, value}`. `value` is `null` when the handler returns undefined.
- `{t:"result", id, ok:false, error:string}`.
- `{t:"event", event:WireEvent, s?}`.
- `{t:"tick", hosts?}`.

### Rules
- The desktop's sign-in handling is in `server.ts:247-305`:
  - Exactly one sign-in per socket.
  - A bad token gets `denied` with "This phone isn't paired with Relay anymore.", then the socket closes.
  - A storage failure closes the socket without `denied`, so the phone retries.
  - A non-pair/auth first frame is refused with "Pair this phone first."
- `bridge` is read as `Number(frame.bridge) || 0`.
- Calls outside `remoteMethods`, or with `args.length > 4`, return `ok:false` (`:311-314`).
- After `paired`/`ready`, the phone always calls `overview` (`RemoteProvider.tsx:163`).
- The UI flags the desktop as outdated when `overview.bridge < 22` (`:397`).

---

## 5. Methods, events and schemas

### Timeouts and argument handling
- Phone timeout per call: **15 s**, or **120 s** for slow methods:
  - `slowRemoteMethods`: `sendDraft`, `receiveHandoff`, `handBack`, `handoffUpload`, `handoffDownload`.
  - `slowPhoneMethods`: `sendProjectChat`, `createProjectChat`, `projectGitAction`, `projectCommitMessage`, `projectMergePlan`, `projectMergeBranch`, `projectCiStatus`, `providerUsage`, `regenerateProjectChatTitle`.
  - Lists are at `shared/remote.ts:663-688`.
- A timeout or drop raises `Unanswered`, which is distinct from a rejection (`remote-client.ts:654`).
- JSON has no `undefined`: trailing undefined args are dropped (`:194-195`); missing optional args are sent as `null`, which the desktop treats as absent.

### RemoteApi (`shared/remote.ts:498-596`)
Validated in `electron/remote/bridge.ts:427-512`; the schemas are at `bridge.ts:106-157`. Arguments are positional in `args[]`.

- **`overview()`** → `RemoteOverview` (`:284-303`):
  - `{name, bridge?, version?, appearance?:PhoneAppearance, dictation?: "…status", readAloud?:boolean, present?:boolean, drafts?:SharedDraft[], projects:RemoteProject[], chats:RemoteChatSummary[]}`.
  - `RemoteProject` (`:149-158`): `{id, name, folder?, scratch?, plain?, workspace?}`.
  - `RemoteChatSummary` (`:108-147`):
    - required: `id, projectId, title, scope, updated, created`;
    - optional: `provider, running, runningSince, waiting, asking, blocked, settledAt, settleWhenDone, autoSettled, markedUnread, snoozedAt, snoozedUntil, seenAt, branch, worktree, pending, nextSend, queueMark, empty, goal, startedBy, limitResume, notesMark`.
    - `notesMark` (bridge ≥ 22) changes whenever the thread's notes do; fetch them again with `desktop("threadNotes", [id])`.
    - Up to 300, sorted by `updated` descending, then `id` ascending (`bridge.ts:571-588`, `chatOrder` `remote-delta.ts:102`).
  - `PhoneAppearance` / palette: `#rrggbb` colours, strict (`phone-remote.ts:77-103`).
- **`chat(id:uuid, known?:Record<msgId,version> /* ≤20000 */, history?:1..1000 /* default 100 */, sendId?:uuid)`** → `RemoteChat` (`:331-361`; built at `bridge.ts:218-280`):
  - `{id, projectId, title, scope, messages:(ChatMessage|string)[], requests, queuePaused, stopped?, pending?, worktree?, workspaceMoves? /* bridge ≥ 22, shared/workspace-moves.ts */, running, root?, earlier, cost?, queue:RemoteQueued[], scheduled:(RemoteQueued&{at})[], settings?, lastParentId?, hasSend?, sendPending?}`.
  - A string entry in `messages` is the id of a message the phone already holds at that version. Rebuild with `applyChatPatch` (`shared/projects/sync.ts:26-40`); a missing id throws `MissingMessage`.
  - `knownOf` = `{[m.id]: m.version}`.
  - `sendId` asks for a receipt: `hasSend` / `sendPending` (used by the outbox, `mobile/src/remote/outbox.ts:180`).
- **`ChatMessage`** (`shared/projects/messages.ts:82-165`):
  - required: `id, role:"user"|"assistant", body, status:"complete"|"streaming"|"failed"|"cancelled", created, provider, version`;
  - plus about 40 optional fields: `trace`, `activity`, `renders`, `images`, `questions`, `changes`, `parentId`, `seq`, `context`, `cost`, …
  - `AgentTrace` = `{kind:"commentary", id, text} | {kind:"activity", id, activity:AgentActivity}`.
  - `AgentActivity` (`:185-204`): `{id, kind:"command"|"file"|"read"|"search"|"web"|"agent"|"tool", label, status:"running"|"complete"|"failed"|"stopped", detail?, questionAnswers?, detailCut?, parentId?, progress?, mcp?, image?}`.
  - On phones, `detail` longer than 600 chars becomes `first300 + "\n…\n" + last300`, with `detailCut = len − 600` (`bridge.ts:601-612`).
  - Turn rendering logic: `shared/agent-trace.ts` (`groupTrace :60`, `readTurn :80`, `turnHeading :114`, `batchHead :136`).
- **`activityDetail(chatId, messageId, activityId /* 1..200 chars */)`** → `string|null`. The full tool output.
- **`diff(source)`** → `RemoteDiff`:
  - `source` is one of:
    - `{kind:"turn", chatId, messageId, path}`
    - `{kind:"working", where /* ≤80 */, path, area:"staged"|"unstaged"}`
    - `{kind:"commit", where, sha /* ≤64 */, path}`
    - `{kind:"worktree", chatId, path}`
  - `path` is 1–1000 chars. All variants are strict (`bridge.ts:128-156`).
  - Result: `{path, binary, hunks:[{header:"@@ -a,b +c,d @@", lines:[{kind:"add"|"del"|"same", text, old?, new?}]}], truncated}`. Capped at 3000 lines; 3 lines of context (`bridge.ts:675-714`).
- **`subagents(chatId, known? /* 64-hex sha256 */)`** → `null` if unchanged, else `{signature, runs:SubagentRun[]}`, with briefs stripped. `signature` = sha256 hex of `JSON.stringify(runs)`.
- **`subagentRun(chatId, agentId, known?)`** → `null` if unchanged, else `{signature, run:SubagentDetail|null}`.
  - Types are in `shared/subagents.ts:16-51`.
  - The phone polls every 5 s, backing off to 20 s without changes and 60 s on errors (`mobile/src/remote/subagent-poll.ts`).
- **`image(source, max:int 16..4096)`** → data URL, shrunk so its longer side is at most `max`. Bridge ≥ 14.
  - `source` = `{kind:"attached", chatId, imageId}`, `{kind:"read", chatId, messageId, path}`, or from bridge 22 `{kind:"preview", chatId, messageId}` (the frame `ChatMessage.preview` kept when `shot`).
  - Older bridges: use `desktop("projectChatImage" | "projectChatReadImage")` instead.
- **`renderPage(chatId, renderId, page:0..11)`** → HTML string (`RENDER_MAX_PAGES = 12`). Bridge ≥ 17.
  - `ChatMessage.renders: HtmlRender{id, title, pages:[{label?, heights?:number[] /* per RENDER_WIDTHS [320,480,640,800,960,1120] */}], created}` (`shared/html-render.ts:7-42`).
- **`projectIcons(known:Record<projectId, hash|null> /* ≤1000 */)`** → `Record<id, {hash, dataUrl}|{hash:null}>`. `hash` = the first 16 hex chars of sha256(dataUrl) (`bridge.ts:379-397`).
- **Drafts** (bridge ≥ 19, `shared/drafts.ts`):
  - `saveDraft(DraftWrite)` → `SharedDraft|null`.
  - `draftOther(key, drop:boolean)` → `SharedDraft|null`.
  - `sendDraft(key, chatId|null, ProjectChatSend)` → `{chatId}`.
  - Key regex: `^(?:ID(?::ID)?|new:ID(?::[a-z0-9]{1,16})?)$` with `ID = [A-Za-z0-9_-]{1,80}`.
  - `DraftWrite` (strict, `:113-121`): `{key, text /* ≤200000 */, skills?, quotes?, files?, workspace?, base:int≥0, at:int≥0, extras?, sent?}`.
  - `SharedDraft`: `{key, text, …body, rev≥1, at, by:"desktop"|"phone:<id>", origin, extras?, other?}`.
- **Dictation** (`shared/remote.ts:458-473`; strict zod in `phone-remote.ts:47-62`):
  - `dictate({type:"start"|"stop"|"cancel", id:int≥0})`, or `{type:"audio", id, pcm}`.
  - `pcm` is **standard base64 with padding** (`/^[A-Za-z0-9+/]*={0,2}$/`), at most 44,000 chars, of 16 kHz mono s16le, about 80 ms per chunk.
  - Returns `{settled, tentative, loading}`.
  - A session dies after 10 s with no audio.
- **Read aloud** (bridge ≥ 12):
  - `readAloud({type:"start", id, markdown /* ≤1,000,000 */} | {type:"pull", id} | {type:"stop", id})`.
  - Returns `{pcm /* std base64 s16le mono */, sampleRate /* default 24000 */, loading, done}`, at most 3 s per pull.
  - The phone pulls in a loop (`mobile/src/remote/read-aloud.ts:87-133`).
- **`reportApp(PhoneAppReport)`** (strict, `phone-remote.ts:29-45`): `{version, updated, apk, updates, update?:{kind:"downloading"|"ready"|"apk", version}, failed?}`. Versions match `^\d+\.\d+\.\d+(\.\d+)?$`.
- **APK feed** (direct HTTPS, not over the bridge):
  - Feed: `https://github.com/relaycodehq/relay/releases/latest/download/latest.json`, plus a `.sig` file verified with pinned Ed25519 keys (`shared/updates.ts:4-14`, `shared/phone-release.ts:60-80`, `shared/update-signature.ts`).
  - Checked every 6 h, with a 10 min retry after failure (`mobile/src/remote/latest-app.ts:38-40`).
  - The APK is checked against SHA-512.
- **`computerInfo()`** → `{version, bridge, update}`. **`updateNow()`** → `UpdateState` (`shared/handoff.ts:383`). These are the only "computer" methods phones may call (`phone-remote.ts:148-158`).
- **`desktop(method, args /* ≤10 */)`**: the method must be in `phoneDesktopMethods` (`shared/remote.ts:396-451`). Args are validated by each desktop handler's `takes([...schemas])`:
  - **Threads** (`electron/api/chats.ts`):
    - `createProjectChat` (`:42`): `[id, chatScope, workspace?]`
    - `sendProjectChat` (`:164`): `[id, ProjectChatSend]`
    - `cancelProjectChat` (`:212`): `[id, {steers?}?]`
    - `respondProjectChat` (`:197`)
    - `answerProjectChatQuestion` / `setProjectChatQuestionDismissed` (`:202-207`)
    - `projectChatQueueAction` (`:187`): `[id, "remove"|"steer"|"move", id, …]`
    - `resumeProjectChat` (`:172`)
    - `compactProjectChat` (`:176`)
    - `triageProjectChat` (`:99`)
    - `forkProjectChat` (`:102`)
    - `renameProjectChat` (`:134`)
    - `markProjectChatSeen` (`:160`): `[id, int≥0]`
    - `rewindProjectTurn` (`:274`)
    - `setLimitResume` (`:223`)
    - `stopProjectChatPending` (`:226`)
    - `projectChatAgents` / `projectChatAgent` / `stopProjectChatAgent` (`:229-236`)
    - `projectChatImage` / `projectChatQueuedImages` / `projectChatReadImage` (`:239-245`)
    - `threadNotes` (`:141`): `[id]` → `ThreadNote[]`; `tickThreadNote` (`:149`): `[id, noteId, item /* from 1 */, done]` and `removeThreadNote` (`:157`): `[id, noteId]` → the notes after. Bridge ≥ 22; `ThreadNote` is in `shared/thread-notes.ts`.
    - `selectAgentWorktree` (`:314`)
    - `closeWatchNote` (`:354`)
    - `projectWorktree` (`:285`)
  - **Git and history** (`electron/api/git.ts`):
    - `projectWorkingTree` (`:42`)
    - `projectHistory` (`:62`): `[workspaceId, historyScope, limit]`
    - `projectCommit` (`:67`)
    - `projectBranches` (`:75`)
    - `projectChangeBranch` (`:78`)
    - `projectMergePlan` / `projectMergeBranch` (`:97-101`)
    - `projectCommitMessage` (`:124`)
    - `projectGitAction` (`:149`)
  - **Files, models and CI** (`electron/api/projects.ts`):
    - `projectFiles` (`:256`)
    - `projectFile` (`:322`)
    - `agentModels` (`:232`)
    - `agentDefaults` (`:251`)
    - `projectCommands` (`:227`)
    - `projectCiStatus` (`:338`)
  - **Settings and usage** (`electron/api/settings.ts`):
    - `providerUsage` (`:174`)
    - `aiSettings`, `newThreadAgent`, `saveNewThreadAgent`, `newThreadModels`, `saveNewThreadModel` (`:152-170`)
  - **Tasks** (`electron/api/terminals.ts:40-47`): `projectTasks`, `stopProjectTask`, `restartProjectTask`.
  - Return types are in `shared/projects/api.ts` and `shared/types.ts`.
  - `workspaceId` = `<projectUuid>[/<chatUuid>[?worktree=<urlenc>]]` (`shared/workspaces.ts:8-37`).
- **`ProjectChatSend`** (strict, `shared/projects/send.ts:21-86`):
  - required: `id`, `body` (trimmed, 1–32000), `choice`, `provider`, `runtimeMode`, `interactionMode`;
  - optional: `delivery:"queue"|"steer"`, `sendAt`, `contextWindow:"200k"`, `account`, `to`, `parentId`, `side:true`, `viewing`, `selection`, `images` (≤3 × `{name ≤120, mimeType png|jpeg|webp, dataUrl ≤1.1M chars of data:image/…;base64,…}`), `fromThread`, `pageAnswer`, `skills` (≤20, only send to bridge ≥ 21), `fixes`.
  - The client removes `to` for desktops below bridge 11 (`remote-client.ts:198-201`).

### Push events (`shared/remote.ts:696-715`)
`event.kind` is one of:
- `message`: `{chatId, message, title?}`. Streaming messages are throttled to one per message every 150 ms on the desktop (`bridge.ts:160`, `:514-539`).
- `chats`: `{chats}`, the whole list.
- `appearance`.
- `presence`: `{present}`, whether someone sits at the computer working in Relay (`electron/remote/presence.ts`), so the phone holds back news meanwhile. Sent when it changes: just before the `chats` it applies to when someone comes back, just after when they leave, and by itself when someone leaves without the list moving (checked every 15 s). A fresh overview's `present` starts it over. Only sent to bridge ≥ 19.
- `draft`: `{change:{key, draft|null, sent?}}`. Only sent to bridge ≥ 19.
- `handoff`: computers only.

### Bridge 14 patches
- **`messagePatch`** `{chatId, patch, title?}`. `MessagePatch` (`shared/remote-delta.ts:18-27`):
  - `{id, set?:Partial<ChatMessage>, unset?:key[], body?:{from, text}, trace?:ListPatch, activity?:ListPatch}`.
  - `body`: keep `prev.body[0..from)` and append `text`. `from` counts **UTF-16 code units**, the same as a Kotlin `String` index.
  - `ListPatch {length, items:[index, value][]}`: truncate to `length`, then set each item (`:45-49`).
  - Apply only against the last *streaming* snapshot of that message id from this connection. With no base, ignore the patch (`remote-client.ts:573-597`).
- **`chatsPatch`** `{set:RemoteChatSummary[], remove:id[]}`. Apply to the last `chats`, then re-sort with `chatOrder` (`remote-delta.ts:117-125`).
- **Flow control** (`electron/remote/link-sender.ts`):
  - Streaming frames carry `s`. The phone **must send `{t:"got", s}` immediately for every event that has `s`** (`remote-client.ts:564`).
  - The desktop allows a 16 KiB window of unacknowledged bytes and gives up on an ack after 20 s (`:15-17`).
  - Only the newest snapshot per message is held back.
  - Non-streaming messages are always sent whole.
- **Both ends reset all patch state on every connection.**

### Port tunnel (bridge 23, `shared/remote-tunnel.ts`)
`adb reverse` over the bridge. The phone listens on its own 127.0.0.1 (the desktop's port when it's free and ≥ 1024, else any) and carries each connection to the same port on the desktop's loopback (127.0.0.1, then ::1; never another host, never the bridge's own port).
- Only from a signed-in phone that sent `bridge ≥ 23`; the desktop **terminates** anyone else who sends one (`server.ts`, `tunnel()`).
- Frame: `seal( 0x02 || op u8 || stream u32 BE || body )`. Ops: `1 open` (port u16 BE, phone → desktop), `2 opened`, `3 data` (1..32 KiB), `4 packed` (the same as raw DEFLATE; the desktop packs ≥ 1 KiB chunks that shrink), `5 credit` (u32), `6 end` (TCP FIN), `7 close` (UTF-8 reason, empty for none; also an open's refusal).
- Flow control: per stream and direction at most 256 KiB unconsumed (written to the receiver's socket); the receiver credits consumed bytes back once ≥ 64 KiB. More than the window drops the stream.
- Lifecycle: the phone opens; `opened` or `close(reason)`; data both ways; each side sends `end` as its socket's read side ends; the desktop sends `close("")` once its socket has fully closed, and `close(reason)` on errors. A `close` from either side ends the stream; frames for unknown streams are ignored. At most 24 streams per phone. Every stream ends with the connection.
- `sites()`: `[{port, title, command, projectId, project, chatId?, worktree?}]`, projects' tasks with a listening port, one per port, the bridge's own left out.
- `tunnelAllow(port)`: a port typed into the phone's address bar. The desktop opens a stream only to a port Sites lists (looked up again, at most every 2 s, when it's missing) or one this phone allowed since the desktop started; anything else is refused with `close`. The phone keeps its typed ports and allows them again before loading one.
- Vectors: `shared/remote-tunnel.test.ts` and `TunnelFrameTest.kt` hold the same bytes.

---

## 6. Tests that pin this behaviour

None of these are fixed byte vectors. All of them use random keys, so for Kotlin you would need to generate vectors yourself, for example by running `shared/remote-crypto.ts` with fixed secrets.

- `shared/remote-crypto.test.ts`: round trip; a key mismatch fails; tamper, replay and cross-session replay rejected; base64url matches Node's; pairing URL parse, including the Expo-wrapped form.
- `electron/remote/wire.test.ts`: fflate ↔ node:zlib interop; text frames still read on a compact link; the 32 MiB inflate cap.
- `shared/remote-routes.test.ts`: route classification, ordering, `learnHosts`.
- `electron/remote/server.test.ts`: `makeRoom` eviction rules.
- `electron/remote/link-sender.test.ts`: ack window, ack timeout, patch base.
- `electron/remote/remote-bridge.test.ts`: 150 ms streaming throttle, diffs, icons, history paging, detail cutting, subagent signatures, images, renders.
- `electron/remote/phone-remote.test.ts`: about 30 end-to-end tests driving the real `RemoteClient` against the real server. They cover pairing, routes, better-route swaps, a wrong key, revocation, watchdog, allowlist, timeouts, send receipts, `to` gating, patches matching whole events (`:1157`) and drafts gating (`:1265`).
- Also: `electron/remote/remote-devices.test.ts`, `lan.test.ts`, `tailscale.test.ts`, `phone-read-aloud.test.ts`, `phone-app.test.ts`; `tests/unit/phone-*.test.ts` (18 files, e.g. `phone-pairing`, `phone-outbox-delivery`, `phone-subagent-poll`); the e2e specs `phone-remote`, `phone-drafts`, `phone-dictation` and `phone-read-aloud` `.spec.ts`; and `mobile/src/remote/*.test.ts` (`launch-pairings`, `self-update`, `latest-app`, `apk-install`, `drafts`, `outbox`, `started-peeks`).