# Relay phone ↔ desktop bridge protocol

How the phone apps (`android/`, Kotlin, and `ios/`, Swift) talk to a desktop Relay. The TypeScript in `shared/` and `electron/remote/` is the reference; both apps are ports of it, pinned to it by byte vectors (§6). Paths are relative to the repository root.

- **There is no relay server, rendezvous service or HTTP transport.** The phone opens a direct `ws://` WebSocket to the desktop over a local-network or Tailscale address.
- **The bridge version is `remoteBridgeVersion` in `shared/remote-bridges.ts`**, 36 at the time of writing. Each feature's threshold sits beside it (§4).

Core files:
- Shared: `shared/remote.ts` (frames, `RemoteApi`, events), `remote-pairing.ts` (pairing link, port, protocol), `remote-bridges.ts` (bridge versions), `remote-methods.ts` (allowed and slow methods), `remote-models.ts` (overview, threads, queue), `remote-crypto.ts`, `remote-wire.ts`, `remote-batches.ts`, `remote-delta.ts`, `remote-routes.ts`, `remote-tunnel.ts`, `remote-client.ts` (the reference client; the desktop uses it to reach another computer, and the tests drive it).
- Desktop: `electron/remote/server.ts`, `bridge.ts`, `for-phone.ts`, `link-sender.ts`, `devices.ts`, `phone-remote.ts`, `lan.ts`, `tailscale.ts`.
- Android: `android/app/src/main/java/dev/relay/android/remote/` (`crypto/`, `wire/`, `client/`, `credentials/`, `Bridge.kt`, `Remote.kt`).
- iPhone: `ios/RelayKit/Sources/RelayRemote/` (`Crypto/`, `Wire/`, `Client/`, `Bridge.swift`) and `ios/Relay/Connection/`.

---

## 1. Pairing

### QR payload (`shared/remote-pairing.ts`)
- Format: `relay-remote://pair?h=<hosts comma-joined>&p=<port>&k=<key>&c=<code>&n=<name>`, built with `URLSearchParams` (form encoding).
- The parser finds the query with `/[/:]pair\?(.+)$/`, so wrapped URLs such as `exp://…/--/pair?…` also work.
- Validation:
  - `h`: split on `,` and filtered by `validHost`, which is `/^[A-Za-z0-9.-]{1,253}$/` or `/^\[[0-9a-fA-F:]+\]$/`. At least one host must remain.
  - `p`: an integer from 1 to 65535. The default port is `defaultRemotePort = 47821`.
  - `k`: `/^[A-Za-z0-9_-]{43}$/`. This is the desktop's **static X25519 public key**, 32 bytes as unpadded base64url.
  - `c`: `/^[A-Za-z0-9_-]{16,64}$/`. The desktop generates `randomToken(24)`, which is 32 chars (`electron/remote/devices.ts`).
  - `n`: cut to 80 chars; defaults to `"Relay"`.

### Desktop side (`electron/remote/devices.ts`)
- The static key pair is created once and persisted, sealed by the OS.
- A code expires after 10 min (`pairingMs`).
- Codes are compared in constant time. After 5 wrong guesses the code is killed.
- At most 10 devices can be paired.
- On a successful `pair`:
  - `deviceId = randomUUID()`.
  - `token = randomToken(32)`, 43 base64url chars.
  - The desktop stores only `sha256(token)` as base64url.
  - The device name has control chars stripped and is cut to 60 chars.
- The QR URL is built in `electron/remote/phone-remote.ts`.

### Key exchange
There is no separate pairing crypto. Pairing runs the normal Noise-NK-like handshake (§3) pinned to `k`, then sends a `pair` frame carrying the code. The desktop answers `paired` with `deviceId`, `token`, `name`, `bridge` and `hosts`.

### What the phone stores
One record per paired computer, keyed by the desktop's public key `k`, plus an index `{ids /* pairing order, oldest first */, active?}`:
- Android (`remote/credentials/CredentialStore.kt`): files `computers.bin` and `computer-<id>.bin`, each sealed with a Keystore key. A file that won't open counts as missing for that run but stays listed.
- iPhone (`ios/Relay/Connection/CredentialStore.swift`): Keychain items under the service `dev.relay.computers`, accounts `index` and `computer-<id>`.

`RemoteCredentials`: `{hosts: string[], port: number, key: string, name: string, deviceId: string, token: string, routes?: ("local"|"tailscale")[]}`.

### Several computers
- One live client at a time.
- Pairing waits up to 15 s for that client to come online. Otherwise the phone goes back to the computer it was on. A pairing settles only on the client that started it (`PendingPairing`).
- The device name sent is `Build.MODEL` (or "Android phone") on Android and `UIDevice.current.name` on the iPhone.

---

## 2. Transport

### URL and socket settings
- URL: `ws://<host>:<port>/`. A bare IPv6 host gets brackets (`shared/remote-client.ts`).
- `binaryType = "arraybuffer"`.
- Desktop server (`electron/remote/server.ts`):
  - `perMessageDeflate: false` and `maxPayload: 16 MiB`.
  - Binds to `0.0.0.0` when local network is allowed, otherwise to the first Tailscale IPv4 (`phone-remote.ts`). It re-syncs every 10 s.

### Peer filter (`server.ts`)
The desktop accepts:
- Tailscale peers: `100.64.0.0/10`, `fd7a:115c:a1e0:` prefix, or `127.0.0.1` / `::1` (`tailscale.ts`).
- With local network on, also LAN peers: 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, `fc`/`fd`/`fe8-b` prefixes, `::1` (`lan.ts`).

### Desktop limits
- Requests are checked before sealing against the 16 MiB wire budget, including the encryption tag and legacy base64 expansion. From bridge 31, oversized `desktop/sendProjectChat` and `sendDraft` calls upload in acknowledged batches; other oversized calls fail locally without dropping their attachments.
- 24 connections in total (`server.ts`).
- 4 unauthenticated sockets per address; the oldest idle one is evicted (`makeRoom`).
- 10 s to finish the handshake.

### Route classification and ordering (`shared/remote-routes.ts`)
- `routeKind`:
  - `tailscale`: 100.64–127.x, `fd7a:115c:a1e0:` prefix, or a name ending in `.ts.net`.
  - Everything else is `local`.
- Default order is `["local","tailscale"]`. Hosts are sorted stably by route rank (`orderHosts`).
- At most 8 hosts are kept (`maxHosts`).
- `learnHosts(fresh, via)` = de-duplicated `[...fresh.slice(0,7), via]`.

### Dialing (`shared/remote-client.ts`)
- Hosts are raced in order with a **1500 ms stagger**. A failed dial launches the next one immediately.
- When pairing, the first socket whose channel opens claims the sign-in, and the other dials are cancelled. This ensures the one-time code is sent once.
- Per-dial timeout is 15 s.
- A `denied` reply stops every route and sets status `denied` permanently.

### Reconnect and backoff
- Delay is `min(15000, 1000·2^retry)` ms. The counter resets when a connection comes online.
- `wake()` (app returns to foreground) reconnects at once if offline, or if online but nothing was heard for more than `staleMs/2` = 20 s.

### Better-route probing
- While on a later route, every 60 s the client dials the earlier hosts beside the live link.
- It swaps only when no calls are in flight.
- Hosts that lost are cooled for 5 min.

### Heartbeats
- The desktop runs a 15 s interval (`server.ts`, `tick()`):
  - a WebSocket-level `ping`; a socket that hasn't ponged since the last tick is terminated;
  - plus a sealed `{t:"tick", hosts}` to signed-in devices.
- The phone's watchdog is **40 s** from the last frame received (`staleMs`, `remote-client.ts`). Any opened frame resets it.
- When `tick.hosts` differs from the saved hosts, the phone updates its credentials and re-probes routes.

### In the background (bridge 29)
- The phone sends `{t:"background", on}` when the app goes to the background or comes back, and on connecting while in the background. The notification worker keeps the link up with nothing on screen.
- While `on`, the desktop pings and ticks that connection only every 4th interval (60 s) and sends events in batches every 25 s (`backgroundBatchMs`, `link-sender.ts`). Streaming `message` events are held, newest per id, and go out when the phone is back; a final `message` drops the held one.
- Back (`on:false`), the desktop sends what waited and a `tick` at once.
- The phone's watchdog is 150 s in the background (`backgroundStaleMs`), its retry delay caps at 60 s, and it probes no better routes. Back, it waits 5 s for that tick (`backProbeMs`) and reconnects without one.

---

## 3. Crypto framing (`shared/remote-crypto.ts`)

The code uses noble with no fixed test vectors.

### Hello (plaintext, one each way, as a WebSocket **text** frame)
- Format: `{"t":"hello","v":1,"e":"<base64url(32-byte X25519 ephemeral pub)>"}`. `v` = `remoteProtocol = 1` (`shared/remote-pairing.ts`).
- The phone sends its hello on `onopen`. The desktop replies with its own hello.
- Validation: `t=="hello"`, `v==1`, and the decoded key is exactly 32 bytes.

### Diffie-Hellman
- Curve: X25519, with RFC 7748 clamping from noble.
- An all-zero shared secret is rejected.
- Phone (client):
  - `es = X25519(clientEph.secret, serverStatic)`
  - `ee = X25519(clientEph.secret, serverEph)`
- Desktop computes the mirrors: `X25519(static.secret, clientEph)` and `X25519(eph.secret, clientEph)`.

### Key derivation
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

### Nonce
- 12 bytes: `00 00 00 00` followed by a **64-bit big-endian counter**.
- There is a separate counter per direction. Both start at 0 after the hello; the first sealed frame (`pair`/`auth`) uses 0.
- Strictly sequential, so a dropped, reordered or replayed frame fails authentication. That is the only replay protection; fresh ephemerals stop cross-session replay.
- `received++` happens only after a successful decrypt.

### Base64url
- RFC 4648 URL alphabet, **no padding**.
- Decoding rejects any other character and lengths with `len % 4 == 1`.
- `randomToken(n)` = base64url of n random bytes.

### Envelope (`shared/remote-wire.ts`)

**Text mode** (before compact, and always for `pair`/`auth`/`paired`/`ready`):
- WebSocket text frame = `base64url( seal( UTF-8(JSON) ) )`.

**Binary mode** (both ends at bridge ≥ 14):
- WebSocket binary frame = `seal( flag(1 byte) || body )`.
  - `flag 0x00`: body is UTF-8 JSON.
  - `flag 0x01`: body is **raw DEFLATE** (no zlib header) of the UTF-8 JSON. Level 6 everywhere: `deflateRawSync` on the desktop, fflate in the TS client, `Deflater(6, nowrap = true)` on Android, Apple's `COMPRESSION_ZLIB` (which is raw DEFLATE) on the iPhone.
  - `flag 0x02` (bridge ≥ 23): a port tunnel frame, bytes rather than JSON; see "Port tunnel" in section 5.
- Deflate is used only when `256 ≤ jsonBytes ≤ deflateUpTo` and the result is smaller. `deflateUpTo` is 1 MiB on the phone and unlimited on the desktop (`server.ts`).
- The desktop caps inflate output at 32 MiB.
- Any other flag throws "Unknown frame".
- Receivers accept text frames even on a compact link (`openFrame` branches on frame type).

### Compact switch-over (who sends what)
- The phone sends `pair`/`auth` as **text**, always (`remote-client.ts`, `compact=false`).
- The desktop answers `paired`/`ready` as **text**. Its `LinkSender` is created only after that send (`server.ts`).
- After that:
  - The **desktop** sends binary when the *phone's* declared `bridge ≥ 14`.
  - The **phone** sends binary when the *desktop's* `bridge` in `paired`/`ready` is ≥ 14 (`remote-client.ts`).
- **Pitfall:** the desktop **terminates** a client that sends a binary frame before its link is set up (`server.ts`).
- An undecryptable frame:
  - while dialing → "Couldn't verify … Pair again." (`remote-client.ts`);
  - after sign-in → the phone closes the socket; the desktop terminates on any open failure (`server.ts`).

### Large phone messages (bridge 31)
- Photos already resize and JPEG-compress on the phone to fit the 1.1M-character per-image limit. Batching preserves that image quality and the original message id.
- If a send exceeds one frame, serialize its original `{t:"call", id, method, args}` as UTF-8. Upload consecutive **3 MiB** byte pieces as `{t:"batch", id, batch, n, data, last}`: `batch` is a positive connection-local upload number, `n` starts at zero, `data` is canonical unpadded base64url. Only the last piece can be smaller. Each piece gets a fresh call `id`.
- Wait for the normal `{t:"result", id, ok:true, value:null}` acknowledgement before sending another piece. The last piece returns the original call's result under its own `id`. Nothing is submitted to the agent before that piece.
- The authenticated socket owns incomplete uploads: at most two, **128 MiB total** decoded bytes, expiring after **120 s** without a piece. Invalid or out-of-order pieces discard their upload. Disconnect clears them all. `{t:"batchCancel", batch}` clears an abandoned upload without a reply.
- Only `desktop/sendProjectChat` and `sendDraft` can be assembled; they still run through normal validation and send-id deduplication. On failure, the existing outbox retains the complete send and retries with the same message id. Never resume an upload on a new connection, and don't switch to a better route mid-upload.
- Both ends advertise bridge 31. Older desktops get ordinary sends that fit; oversized sends ask for a desktop update.

### Read only (bridge 32)
- `runtimeMode` may be `read-only`: the agent reads and runs read-only commands but changes no files. Offer it only to a desktop at bridge ≥ 32; older ones reject the send.

### Files (bridge 33)
- `uploadFile(id, name, size, offset, data)` → `{received, path?}`. `id` is a UUID the phone picks per file, `name` its file name (the desktop cleans it), `size` its whole length (≤ **200 MiB**), `data` base64 (standard, padded) of up to **1 MiB** (`fileUploadChunk`; the desktop takes up to 2 MiB) starting at byte `offset`.
- Resumable and idempotent: bytes the desktop already has are skipped, a chunk starting past what it has writes nothing; either way the answer's `received` is where to carry on. A whole file answers `path` (also on any repeat). Send chunks one at a time; after a failure or reconnect, send the next chunk from the last `received` you heard (or 0).
- The file lives in the desktop's paste folder (`<Relay data>/pastes/<id>/<name>`), readable by agents and swept 30 days after nothing names it. The message names it as `` `path` ``, as a desktop file pill does.
- Ask a desktop below bridge 33 for an update rather than sending files.

### Merging pull requests (bridge 34)
- `pullMergeReadiness(ref)` → `{status: "clean"|"conflicts"|"blocked"|"unknown", behind: number|null, methods: ("merge"|"squash"|"rebase")[]}`, the repository's preferred method first.
- `mergePull(ref, head, method)` merges only while the PR's head is still `head`. Azure DevOps answers once its background completion has finished or failed.
- Offer neither to a desktop below bridge 34; ask for an update instead.

---

## 4. Version negotiation and handshake messages (`shared/remote.ts`, `shared/remote-bridges.ts`)

### Current bridge version and feature thresholds
`remoteBridgeVersion = 38`. Features switch on at these bridge versions:

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
| 23 | `tunnelBridge` | Port tunnel frames (`0x02`) and `sites` |
| 24 | `newsBridge`, `agentToolsBridge` | `news` events and `news` catch-up; `agentTools` |
| 25 | `cloneBridge` | `cloneProject` on a paired computer |
| 26 | `pastesBridge` | Saved paste files travel with sends and handoffs |
| 27 | `setupBridge` | `setupProject`, `setupProgress` after a failed clone |
| 28 | `remoteProjectsBridge` | Projects hosted on a paired computer (`Project.computer`), its folders, threads and shells |
| 29 | `backgroundBridge` | `{t:"background", on}`: batched events and slower heartbeats while the app is in the background |
| 30 | `remoteAddingBridge` | Project setup on a paired computer with a chosen clone destination |
| 31 | `messageBatchesBridge` | Oversized sends upload in acknowledged batches |
| 32 | `readOnlyModeBridge` | `runtimeMode: "read-only"` |
| 33 | `filesBridge` | `uploadFile`: phones attach any file |
| 34 | `mergeBridge` | `pullMergeReadiness`, `mergePull` |
| 35 | `traceTreeBridge` | A call's `actions` and `wroteCode`; `activityWritten` |
| 36 | `secondOpinionBridge` | `askSecondOpinion`, `sendSecondOpinion` |
| 37 | `branchMovesBridge` | `projectChatWorkOn`: move a started thread to any branch |
| 38 | `stepsOnOpenBridge` | `chat`'s `steps:"latest"` folds finished turns (`stepsLeftOut`); `messageSteps` fetches one's steps |

### ClientFrame (phone → desktop)
- `{t:"pair", code, device, kind?:"computer", bridge?}`. Phones omit `kind`.
- `{t:"auth", deviceId, token, bridge?}`.
- `{t:"call", id:number /* safe int, starts at 1 */, method, args:unknown[] /* ≤4 */}`.
- `{t:"got", s:number}`.
- `{t:"background", on:boolean}` (bridge ≥ 29).

### ServerFrame (desktop → phone)
- `{t:"paired", deviceId, token, name, bridge?, hosts?}` and `{t:"ready", name, bridge?, hosts?}`.
- `{t:"denied", reason}`.
- `{t:"result", id, ok:true, value}`. `value` is `null` when the handler returns undefined.
- `{t:"result", id, ok:false, error:string}`.
- `{t:"event", event:WireEvent, s?}`.
- `{t:"tick", hosts?}`.

### Rules
- The desktop's sign-in handling is in `server.ts`:
  - Exactly one sign-in per socket.
  - A bad token gets `denied` with "This phone isn't paired with Relay anymore.", then the socket closes.
  - A storage failure closes the socket without `denied`, so the phone retries.
  - A non-pair/auth first frame is refused with "Pair this phone first."
- `bridge` is read as `Number(frame.bridge) || 0`.
- Calls outside `remoteMethods`, or with `args.length > 4`, return `ok:false`.
- After `paired`/`ready`, the phone always calls `overview`.
- Android flags the desktop as outdated below its own `Bridge.VERSION`; the iPhone below `Bridge.oldestCurrent` (22). Features each check their own threshold.

---

## 5. Methods, events and schemas

### Timeouts and argument handling
- Phone timeout per call: **15 s**, or **120 s** for slow methods:
  - `slowRemoteMethods`: `sendDraft`, `receiveHandoff`, `handBack`, `handoffUpload`, `handoffDownload`.
  - `slowPhoneMethods`: `sendProjectChat`, `createProjectChat`, `projectGitAction`, `projectCommitMessage`, `projectMergePlan`, `projectMergeBranch`, `projectCiStatus`, `providerUsage`, `regenerateProjectChatTitle`.
  - The lists are `slowRemoteMethods` and `slowPhoneMethods` in `shared/remote-methods.ts`; the ones above are only a sample, read them there.
- A timeout or drop raises `Unanswered`, which is distinct from a rejection (`remote-client.ts`).
- JSON has no `undefined`: trailing undefined args are dropped; missing optional args are sent as `null`, which the desktop treats as absent.

### RemoteApi (`shared/remote.ts`; models in `shared/remote-models.ts`)
Validated in `electron/remote/bridge.ts`; the schemas are at `bridge.ts`. Arguments are positional in `args[]`.

- **`overview()`** → `RemoteOverview`:
  - `{name, bridge?, version?, appearance?:PhoneAppearance, dictation?: "…status", readAloud?:boolean, present?:boolean, drafts?:SharedDraft[], projects:RemoteProject[], chats:RemoteChatSummary[]}`.
  - `RemoteProject`: `{id, name, folder?, scratch?, plain?, workspace?, computer?:{name, gone?}}`; `computer` (bridge 28) names the paired computer a project's folder is on.
  - `RemoteChatSummary`:
    - required: `id, projectId, title, scope, updated, created`;
    - optional: `provider, running, runningSince, waiting, asking, blocked, settledAt, settleWhenDone, autoSettled, markedUnread, snoozedAt, snoozedUntil, seenAt, branch, worktree, pending, nextSend, queueMark, empty, goal, startedBy, reviewer, limitResume, notesMark`.
    - `reviewer: true` marks a deep review's reviewer. It opens from its review (the thread it was `startedBy`) and stays out of every list: Activity, Projects, search, Needs you. Older desktops leave it out.
    - `notesMark` (bridge ≥ 22) changes whenever the thread's notes do; fetch them again with `desktop("threadNotes", [id])`.
    - Up to 300, sorted by `updated` descending, then `id` ascending (`bridge.ts`, `chatOrder` `remote-delta.ts`).
  - `PhoneAppearance` / palette: `#rrggbb` colours, strict (`phone-remote.ts`).
- **`chat(id:uuid, known?:Record<msgId,version> /* ≤20000 */, history?:1..1000 /* default 100 */, sendId?:uuid, steps?:"all"|"latest")`** → `RemoteChat` (built in `bridge.ts`):
  - `{id, projectId, title, scope, messages:(ChatMessage|string)[], requests, queuePaused, stopped?, pending?, worktree?, workspaceMoves? /* bridge ≥ 22, shared/workspace-moves.ts */, running, root?, earlier, cost?, queue:RemoteQueued[], scheduled:(RemoteQueued&{at})[], settings?, lastParentId?, hasSend?, sendPending?}`.
  - A string entry in `messages` is the id of a message the phone already holds at that version. Rebuild with `applyChatPatch` (`shared/projects/sync.ts`); a missing id throws `MissingMessage`.
  - `knownOf` = `{[m.id]: m.version}`.
  - `RemoteQueued` (`shared/remote-models.ts`): `{id, body, images?, error?, parentId?, to?, settings?, created?, held?}`. `held:true` is a steer the desktop holds ~3s before its agent gets it: show it as your sent message with a spinner and ×, not in the queue list.
  - `sendId` asks for a receipt: `hasSend` / `sendPending` (used by the outbox, `remote/outbox/Outbox.kt`).
  - `steps:"latest"` (bridge ≥ 38; older desktops ignore it) folds every finished assistant turn but the newest (`electron/remote/steps-left-out.ts`): its `trace` keeps only the calls shown outside the fold (images it looked at, started threads) and the last call, for the heading's icon; `stepsSummary` is the heading the whole turn reads, shown in place of one counted from the calls held; `stepsLeftOut` says how many entries were left out. Fetch them with `messageSteps` when the fold opens.
- **`ChatMessage`** (`shared/projects/messages.ts`):
  - required: `id, role:"user"|"assistant", body, status:"complete"|"streaming"|"failed"|"cancelled", created, provider, version`;
  - plus about 40 optional fields: `trace`, `activity`, `renders`, `images`, `questions`, `changes`, `parentId`, `seq`, `context`, `cost`, …
  - `AgentTrace` = `{kind:"commentary", id, text} | {kind:"activity", id, activity:AgentActivity}`.
  - `AgentActivity`: `{id, kind:"command"|"file"|"read"|"search"|"web"|"agent"|"tool", label, status:"running"|"complete"|"failed"|"stopped", detail?, questionAnswers?, detailCut?, parentId?, progress?, mcp?, image?}`.
  - On phones, `detail` longer than 600 chars becomes `first300 + "\n…\n" + last300`, with `detailCut = len − 600` (`bridge.ts`).
  - Turn rendering logic: `shared/agent-trace.ts` (`groupTrace`, `readTurn`, `turnHeading`).
- **`activityDetail(chatId, messageId, activityId /* 1..200 chars */)`** → `string|null`. The full tool output.
- **`messageSteps(chatId:uuid, messageId:uuid)`** → `{trace?, activity?, traceDropped?}|null` (bridge ≥ 38). A folded turn's steps, cut as `chat` cuts them; put them in place of the folded ones and drop `stepsLeftOut` and `stepsSummary`. Null once the message is gone.
- **`diff(source)`** → `RemoteDiff`:
  - `source` is one of:
    - `{kind:"turn", chatId, messageId, path}`
    - `{kind:"working", where /* ≤80 */, path, area:"staged"|"unstaged"}`
    - `{kind:"commit", where, sha /* ≤64 */, path}`
    - `{kind:"worktree", chatId, path}`
  - `path` is 1–1000 chars. All variants are strict (`bridge.ts`).
  - Result: `{path, binary, hunks:[{header:"@@ -a,b +c,d @@", lines:[{kind:"add"|"del"|"same", text, old?, new?}]}], truncated}`. Capped at 3000 lines; 3 lines of context (`bridge.ts`).
- **`subagents(chatId, known? /* 64-hex sha256 */)`** → `null` if unchanged, else `{signature, runs:SubagentRun[]}`, with briefs stripped. `signature` = sha256 hex of `JSON.stringify(runs)`.
- **`subagentRun(chatId, agentId, known?)`** → `null` if unchanged, else `{signature, run:SubagentDetail|null}`.
  - Types are in `shared/subagents.ts`.
  - The phone polls every 5 s, backing off to 20 s without changes and 60 s on errors (Android `features/thread/SubagentPoll.kt`).
- **`image(source, max:int 16..4096)`** → data URL, shrunk so its longer side is at most `max`. Bridge ≥ 14.
  - `source` = `{kind:"attached", chatId, imageId}`, `{kind:"read", chatId, messageId, path}`, or from bridge 22 `{kind:"preview", chatId, messageId}` (the frame `ChatMessage.preview` kept when `shot`).
  - Older bridges: use `desktop("projectChatImage" | "projectChatReadImage")` instead.
- **`renderPage(chatId, renderId, page:0..11)`** → HTML string (`RENDER_MAX_PAGES = 12`). Bridge ≥ 17.
  - `ChatMessage.renders: HtmlRender{id, title, pages:[{label?, heights?:number[] /* per RENDER_WIDTHS [320,480,640,800,960,1120] */}], created}` (`shared/html-render.ts`).
- **`projectIcons(known:Record<projectId, hash|null> /* ≤1000 */)`** → `Record<id, {hash, dataUrl}|{hash:null}>`. `hash` = the first 16 hex chars of sha256(dataUrl) (`bridge.ts`).
- **Drafts** (bridge ≥ 19, `shared/drafts.ts`):
  - `saveDraft(DraftWrite)` → `SharedDraft|null`.
  - `draftOther(key, drop:boolean)` → `SharedDraft|null`.
  - `sendDraft(key, chatId|null, ProjectChatSend)` → `{chatId}`.
  - Key regex: `^(?:ID(?::ID)?|new:ID(?::[a-z0-9]{1,16})?)$` with `ID = [A-Za-z0-9_-]{1,80}`.
  - `DraftWrite` (strict): `{key, text /* ≤200000 */, skills?, quotes?, files?, workspace?, base:int≥0, at:int≥0, extras?, sent?}`.
  - `SharedDraft`: `{key, text, …body, rev≥1, at, by:"desktop"|"phone:<id>", origin, extras?, other?}`.
- **Dictation** (`shared/remote-models.ts`; strict zod in `phone-remote.ts`):
  - `dictate({type:"start"|"stop"|"cancel", id:int≥0})`, or `{type:"audio", id, pcm}`.
  - `pcm` is **standard base64 with padding** (`/^[A-Za-z0-9+/]*={0,2}$/`), at most 44,000 chars, of 16 kHz mono s16le, about 80 ms per chunk.
  - Returns `{settled, tentative, loading}`.
  - A session dies after 10 s with no audio.
- **Read aloud** (bridge ≥ 12):
  - `readAloud({type:"start", id, markdown /* ≤1,000,000 */} | {type:"pull", id} | {type:"stop", id})`.
  - Returns `{pcm /* std base64 s16le mono */, sampleRate /* default 24000 */, loading, done}`, at most 3 s per pull.
  - The phone pulls in a loop (Android `features/readaloud/ReadAloud.kt`).
- **`reportApp(PhoneAppReport)`** (strict, `phone-remote.ts`): `{version, updated, apk, updates, update?:{kind:"downloading"|"ready"|"apk", version}, failed?}`. Versions match `^\d+\.\d+\.\d+(\.\d+)?$`.
- **APK feed** (direct HTTPS, not over the bridge):
  - Feed: `https://github.com/relaycodehq/relay/releases/latest/download/latest.json`, plus a `.sig` file verified with pinned Ed25519 keys (`shared/updates.ts`, `shared/phone-release.ts`, `shared/update-signature.ts`).
  - Checked every 6 h, with a 10 min retry after failure (Android `features/updates/LatestApp.kt`).
  - The APK is checked against SHA-512.
- **`computerInfo()`** → `{version, bridge, update}`. **`updateNow()`** → `UpdateState` (`shared/handoff.ts`). These are the only "computer" methods phones may call (`phone-remote.ts`).
- **`desktop(method, args /* ≤10 */)`**: the method must be in `phoneDesktopMethods` (`shared/remote-methods.ts`). Args are validated by each desktop handler's `takes([...schemas])`:
  - **Threads** (`electron/api/chats.ts`):
    - `createProjectChat`: `[id, chatScope, workspace?]`
    - `sendProjectChat`: `[id, ProjectChatSend]`
    - `cancelProjectChat`: `[id, {steers?}?]`
    - `respondProjectChat`
    - `answerProjectChatQuestion` / `setProjectChatQuestionDismissed`
    - `projectChatQueueAction`: `[id, "remove"|"steer"|"move", id, …]`
    - `resumeProjectChat`
    - `compactProjectChat`
    - `triageProjectChat`
    - `forkProjectChat`
    - `renameProjectChat`
    - `markProjectChatSeen`: `[id, int≥0]`
    - `rewindProjectTurn`
    - `setLimitResume`
    - `stopProjectChatPending`
    - `projectChatAgents` / `projectChatAgent` / `stopProjectChatAgent`
    - `projectChatImage` / `projectChatQueuedImages` / `projectChatReadImage`
    - `threadNotes`: `[id]` → `ThreadNote[]`; `tickThreadNote`: `[id, noteId, item /* from 1 */, done]` and `removeThreadNote`: `[id, noteId]` → the notes after. Bridge ≥ 22; `ThreadNote` is in `shared/thread-notes.ts`.
    - `selectAgentWorktree`
    - `projectChatWorkOn`: `[id, branch]` → `ChatSummary`. Bridge ≥ 37: moves a started thread to `branch` wherever it's worked on (the folder it's checked out in, the project folder, or a worktree on it); the project folder itself is switched with `projectChangeBranch` first.
    - `closeWatchNote`
    - `projectWorktree`
  - **Git and history** (`electron/api/git.ts`):
    - `projectWorkingTree`
    - `projectHistory`: `[workspaceId, historyScope, limit]`
    - `projectCommit`
    - `projectBranches`
    - `projectChangeBranch`
    - `projectMergePlan` / `projectMergeBranch`
    - `projectCommitMessage`
    - `projectGitAction`
  - **Files, models and CI** (`electron/api/projects.ts`):
    - `projectFiles`
    - `projectFile`
    - `agentModels`
    - `agentDefaults`
    - `projectCommands`
    - `projectCiStatus`
  - **Settings and usage** (`electron/api/settings.ts`):
    - `providerUsage`
    - `aiSettings`, `newThreadAgent`, `saveNewThreadAgent`, `newThreadModels`, `saveNewThreadModel`
  - **Tasks** (`electron/api/terminals.ts`): `projectTasks`, `stopProjectTask`, `restartProjectTask`.
  - Return types are in `shared/projects/api.ts` and `shared/types.ts`.
  - `workspaceId` = `<projectUuid>[/<chatUuid>[?worktree=<urlenc>]]` (`shared/workspaces.ts`).
- **`ProjectChatSend`** (strict, `shared/projects/send.ts`):
  - required: `id`, `body` (trimmed, 1–32000), `choice`, `provider`, `runtimeMode`, `interactionMode`;
  - optional: `delivery:"queue"|"steer"`, `sendAt`, `contextWindow:"200k"`, `account`, `to`, `parentId`, `side:true`, `viewing`, `selection`, `images` (array of `{name ≤120, mimeType png|jpeg|webp, dataUrl ≤1.1M chars of data:image/…;base64,…}`; no fixed count limit), `fromThread`, `pageAnswer`, `skills` (≤20, only send to bridge ≥ 21), `fixes`.
  - The client removes `to` for desktops below bridge 11 (`remote-client.ts`).

### Push events (`shared/remote.ts`)
`event.kind` is one of:
- `message`: `{chatId, message, title?}`. Streaming messages are throttled to one per message every 150 ms on the desktop (`bridge.ts`).
- `chats`: `{chats}`, the whole list.
- `news`: `{item}`, a thread finished, failed or needs you, as the computer decided. Only sent to bridge ≥ 24.
- `appearance`.
- `presence`: `{present}`, whether someone sits at the computer working in Relay (`electron/remote/presence.ts`), so the phone holds back news meanwhile. Sent when it changes: just before the `chats` it applies to when someone comes back, just after when they leave, and by itself when someone leaves without the list moving (checked every 15 s). A fresh overview's `present` starts it over. Only sent to bridge ≥ 19.
- `draft`: `{change:{key, draft|null, sent?}}`. Only sent to bridge ≥ 19.
- `handoff`, `terminal`: computers only.

### Bridge 14 patches
- **`messagePatch`** `{chatId, patch, title?}`. `MessagePatch` (`shared/remote-delta.ts`):
  - `{id, set?:Partial<ChatMessage>, unset?:key[], body?:{from, text}, trace?:ListPatch, activity?:ListPatch}`.
  - `body`: keep `prev.body[0..from)` and append `text`. `from` counts **UTF-16 code units**, the same as a Kotlin `String` index.
  - `ListPatch {length, items:[index, value][]}`: truncate to `length`, then set each item.
  - Apply only against the last *streaming* snapshot of that message id from this connection. With no base, ignore the patch (`remote-client.ts`).
- **`chatsPatch`** `{set:RemoteChatSummary[], remove:id[]}`. Apply to the last `chats`, then re-sort with `chatOrder` (`remote-delta.ts`).
- **Flow control** (`electron/remote/link-sender.ts`):
  - Streaming frames carry `s`. The phone **must send `{t:"got", s}` immediately for every event that has `s`** (`remote-client.ts`).
  - The desktop allows a 16 KiB window of unacknowledged bytes and gives up on an ack after 20 s.
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

**Byte vectors.** The TypeScript's output for fixed keys (server static secret bytes 1…32, client ephemeral 33…64, server ephemeral 65…96) is checked into both apps: `ios/RelayKit/Tests/RelayRemoteTests/Fixtures/ts-*.json` and `android/app/src/test/java/dev/relay/android/remote/TsVectors.kt` hold the same values. They cover public keys, hellos, session keys, seals at counters 0 and 1, desktop frames to open, wire codec, routes, pairing links and patches.
- Android: `remote/CrossImplementationTest.kt` and `SealedForTsTest.kt` (`./gradlew :app:testDebugUnitTest --tests 'dev.relay.android.remote.*'`).
- iPhone: `CrossImplementationTests.swift` and `PairingRoutesDeltaTests.swift` (`swift test` in `ios/RelayKit`).
- No script regenerates the vectors. If you change the crypto or the wire on purpose, produce new ones from `shared/remote-crypto.ts` and `remote-wire.ts` with the same fixed secrets and update both files together.

**TypeScript:**
- `shared/remote-crypto.test.ts`: round trip; a key mismatch fails; tamper, replay and cross-session replay rejected; base64url matches Node's.
- `electron/remote/wire.test.ts`: fflate ↔ node:zlib interop; text frames still read on a compact link; the 32 MiB inflate cap.
- `shared/remote-routes.test.ts`: route classification, ordering, `learnHosts`.
- `electron/remote/server.test.ts`: `makeRoom` eviction rules.
- `electron/remote/link-sender.test.ts`: ack window, ack timeout, patch base.
- `electron/remote/remote-bridge.test.ts`: 150 ms streaming throttle, diffs, icons, history paging, detail cutting, subagent signatures, images, renders.
- `electron/remote/phone-remote.test.ts`: about 30 end-to-end tests driving the real `RemoteClient` against the real server. They cover pairing, routes, better-route swaps, a wrong key, revocation, watchdog, allowlist, timeouts, send receipts, `to` gating, patches matching whole events and drafts gating.
- Also: `electron/remote/remote-devices.test.ts`, `lan.test.ts`, `tailscale.test.ts`, `phone-read-aloud.test.ts`, `presence.test.ts`, `message-batches.test.ts`, `phone-tunnel.test.ts`; `shared/remote-client.test.ts`, `remote-tunnel.test.ts`; `tests/unit/phone-bridge.test.ts`, `phone-fixture.test.ts`; the e2e specs `phone-remote`, `phone-drafts`, `phone-draft-echo`, `phone-dictation` and `phone-read-aloud` `.spec.ts`.
