# Relay room server — experimental protocol 2

The server stores project membership, pull request rooms, completed agent answers in them and opt-in saved-file synchronization in SQLite. Each participant runs their own Codex or Claude locally. Threads and partial token streams stay on the requesting computer.

## Access requirements

Every participant must sign in to Gitea, have access to the repository, and link a matching local Git clone. An invitation alone is insufficient. The desktop checks the clone; the server independently checks the Gitea identity and repository. A Git remote is not a cryptographic access proof—Gitea authorization is the security boundary.

**The room server receives the participant's Gitea token over HTTPS for verification.** This requires explicit consent in the desktop. It only sends the token to operator-allowlisted Gitea base URLs and never persists it or logs it. Provider credentials never leave the participant's computer. Repository grants last at most 60 seconds, are renewed by the desktop, and are lost on server restart. Existing downloaded history cannot be revoked retroactively.

Use a server and administrator you trust: shared messages and synced source files are readable by the server administrator and authorized project members. This is not end-to-end encryption. All rooms in a project are available to its members; there are no per-room private subgroups. Invitations expire in 24 hours and are single use. Project owners can revoke membership from the PR room's people panel.

Only configured Gitea URLs can be contacted. Redirects are rejected, response sizes and request duration are bounded, and browser-origin requests are rejected. Session tokens are hashed in SQLite. Do not log HTTP bodies or authorization headers in a proxy.

## Mac mini installation

Install Node.js **22.16 or newer** and Python 3. Extract `ReviewRelay-RoomServer.tar.gz`, then run inside its folder as your normal Mac user:

```sh
python3 install-rooms-macos.py --gitea-server https://gitea.example.com/gitea
```

Repeat `--gitea-server` for additional trusted hosts. The server must be able to resolve and reach each Gitea host; private hosts require appropriate DNS/VPN routing. Do not replace a private host with an untrusted proxy to bypass this check.

This installs a user LaunchAgent, listening on `127.0.0.1:4319`. The Mac must stay awake and the user logged in. Updates preserve the database, setup key, and prior Gitea allowlist unless new `--gitea-server` arguments are supplied. Data lives in `~/Library/Application Support/Review Relay Rooms/`. The setup key and service file use owner-only permissions.

Put HTTPS in front of the loopback service. The supplied Caddy example supports either a dedicated host or a path prefix. With a prefix such as `/review-relay`, strip it before proxying to port 4319. Do not expose the unencrypted backend port to the Internet. Invitation URLs use the HTTPS address configured in the desktop.

In the owner's desktop, use **Settings → Shared rooms → Manage hosting access** to save the public URL and setup key. The key is encrypted in the OS credential store and is never included in an invitation or distributed app. To copy the key locally without printing it:

```sh
pbcopy < "$HOME/Library/Application Support/Review Relay Rooms/setup-key.txt"
```

Open a pull request's room and create an invitation from its people panel. Copy it to your colleague. The HTTPS landing page opens the installed app through `relay-room:`; the colleague selects the matching local clone and verifies their own Gitea account. Browsers may ask before opening the app. The app must be installed first.

Stop/remove the login service without deleting data:

```sh
python3 install-rooms-macos.py --uninstall
```

## Upgrading from protocol 1

Upgrade clients and server together. Old clients lack repository verification and cannot use protocol 2 shared endpoints. Old project/chat/message IDs and saved workspaces are migrated in place; history is retained. Existing unverified memberships require a fresh invitation, or the server owner can reconnect using the saved hosting setup key. This binds the new membership to its verified Gitea identity. Do not discard the database or setup key.

Before installing, back up SQLite with the SQLite online backup API (including committed WAL contents). Alternatively stop the server and copy the database, WAL and SHM files together. Keep the setup key, previous server bundle and LaunchAgent configuration in a private backup. A rollback requires restoring the compatible database backup as well as the server.

## Docker or direct Node

From this checkout, create an owner-readable `server/.secrets/setup-key.txt` containing a 32-byte base64url secret, then:

```sh
export RELAY_ROOMS_GITEA_SERVERS=https://gitea.example.com/gitea
docker compose -f server/compose.yml up -d --build
```

The container is non-root, has a read-only root filesystem, uses a persistent volume for SQLite, and exposes only loopback port 4319. HTTPS still belongs at the reverse proxy.

For direct Node execution, build with `npm run build:server` and set `RELAY_ROOMS_SETUP_KEY_FILE`, `RELAY_ROOMS_GITEA_SERVERS` (comma-separated), `RELAY_ROOMS_DB`, and optionally `HOST` / `PORT`. Run `node dist-server/server.mjs`. `/health` returns protocol version 2 and `repositoryAccess: true`; it does not validate connectivity or issue credentials.

## Saved-file synchronization

File sync is off until each person explicitly enables it for the pull request's room. Both clones must start at the same commit. Saved UTF-8 working changes (including new files/deletions) are exchanged, with per-file compare-and-swap revisions. Concurrent differing edits stop that file with an explicit conflict; they never silently overwrite one another. Unsent editor buffers are not broadcast, and stale local saves are rejected after disk changes.

Git staging, commits, branches and pushes remain local. Branch switches and Git operations pause synchronization. Reopen/restart requires explicit resume. Ignored files, binaries, symlinks, submodules, LFS and files over 2 MiB are excluded. A room workspace is bounded to 2,000 files / 64 MiB. This is saved-file collaboration, not keystroke-level CRDT editing.

## Verification

Unit/integration tests cover authorization, identity binding, revoked repository access, allowlist enforcement, migration, idempotent invitations/messages, durable final delivery, saved-file conflicts and path safety. Hidden Electron tests exercise rooms, separate local agents, invitations, file sync and explicit Git actions. Live deployment still needs verification against the operator's actual Gitea network and clients; fixture tests cannot prove that network works.
