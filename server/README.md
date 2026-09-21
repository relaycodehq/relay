# Review Relay room server — experimental

This server stores project membership, PR-room messages, replies, shared code excerpts and agent answers in SQLite. It never runs an agent or receives Gitea/provider credentials. Each participant invokes **their own local agent** by starting a message with `@codex` or `@claude`. Ordinary messages are human conversation. Mentioning an agent in quoted code or in the middle of a sentence does not run it.

## On your Mac mini

Use the `ReviewRelay-RoomServer.tar.gz` bundle. It contains a self-contained server, this guide and an installer. Install Node.js **22.16 or newer** and Python 3, extract the bundle, then run inside its folder:

```sh
python3 install-rooms-macos.py
```

No sudo. This creates a user LaunchAgent, starts the server at `http://127.0.0.1:4319`, and restarts it when that Mac user logs in. The Mac must stay awake and logged in for the service to remain available. An existing managed installation is updated in place; its database and setup key are retained.

Data and logs live in `~/Library/Application Support/Review Relay Rooms/`. The generated `setup-key.txt` is an administrator secret, readable only by that Mac user. To copy it locally without printing it in terminal output:

```sh
pbcopy < "$HOME/Library/Application Support/Review Relay Rooms/setup-key.txt"
```

Open a PR in **Review Relay Experimental**, click the chat icon, choose **Set up project**, enter the server address and paste that setup key. Create a separate one-use invitation for each colleague from **People in this project**. They paste it into **Join project** while reviewing a PR from the same Gitea repository. They need their own Gitea login and repository access.

For remote colleagues, serve port 4319 through an HTTPS reverse proxy or a private HTTPS tunnel. The desktop accepts HTTPS remotely and HTTP only on loopback. Do not forward an unencrypted port from your router. Configure the public/private HTTPS address before making invitations; they include the address used to connect. No domain, router, TLS service or VPN is configured by the installer.

To stop and uninstall the login service, from the extracted bundle:

```sh
python3 install-rooms-macos.py --uninstall
```

This preserves messages, setup key and logs.

## Run without the Mac installer

From source:

```sh
npm ci
npm run build:server
mkdir -p room-data
node -e "require('node:fs').writeFileSync('room-data/setup-key.txt',require('node:crypto').randomBytes(32).toString('base64url'),{mode:0o600,flag:'wx'})"
RELAY_ROOMS_SETUP_KEY_FILE="$PWD/room-data/setup-key.txt" npm run start:server
```

The bundle can also run directly with `RELAY_ROOMS_SETUP_KEY_FILE=/path/to/key.txt node server.mjs`. Options: `HOST` (default `127.0.0.1`), `PORT` (4319), `RELAY_ROOMS_DB` (`./room-data/rooms.sqlite`), `RELAY_ROOMS_SETUP_KEY_FILE`. `/health` returns `{ "ok": true, "protocol": 1 }`. Errors and logs do not print credentials or conversation bodies.

## Docker alternative

From the repository root:

```sh
node -e "const fs=require('node:fs');fs.mkdirSync('server/.secrets',{mode:0o700});fs.writeFileSync('server/.secrets/setup-key.txt',require('node:crypto').randomBytes(32).toString('base64url'),{mode:0o644,flag:'wx'})"
docker compose -f server/compose.yml up -d --build
```

The image runs as the unprivileged `node` user. A named volume stores SQLite. The published port binds to loopback. Supply HTTPS separately. The host secret directory is private (0700); its mounted secret file is readable by the unprivileged container user. Docker deployment was not exercised in this build; the same bundled server was tested directly under Node.

## Account and invitation behavior

- Room membership is independent of Gitea membership. The app validates repository identity when joining and checks the PR revision against the user's own Gitea connection before sharing code. The room server does **not** independently verify Gitea permissions. A project invitation grants access to all of that project's room history; share it only with trusted colleagues. Names are labels; the server-issued member ID is the authenticated identity.
- Invitations expire after 24 hours and can be used once. The owner can remove a participant immediately. A member's session expires after 90 days. Removing someone does not erase their existing messages or copies they already received. Unused invitations currently expire rather than offering a separate revoke control.
- Each desktop encrypts its room session with the OS credential store when available. Without secure storage it is session-only. Gitea tokens, Codex/Claude auth and unrelated local/private conversations never go to the server.
- The server and members can read shared content. This is not end-to-end encrypted. Back up the database and keep server access restricted. Stop the service before copying `rooms.sqlite`, or use SQLite's online backup API; do not copy only the database while WAL writes are active.

## Agent behavior

Codex uses its official stdio app-server interface. Verified with **Codex CLI 0.154.0** and Luna. Each question gets a fresh ephemeral thread with a named read-only permission profile, repository-only file access plus Codex's minimal platform files, denied network, disabled configured MCP servers and no approval escalation. Unsupported permission-profile support fails closed. This does not change saved Codex configuration.

Claude uses local Claude Code's streaming CLI. Verified with **Claude Code 2.1.278**. It requires support for `--restricted` (2.1.248+) and `--safe-mode`; the available tools are `Read`, `Glob`, `Grep`. Shell, write tools, external MCP tools and personal customizations are disabled for these questions. Its own sign-in is preserved. Because it has no shell, it cannot inspect historical Git blobs beyond supplied excerpts when your checkout differs.

The room's model/effort controls apply to Codex; Fast is explicitly on or off. Claude has separate model and effort fields. Invalid or unavailable models produce a visible error, never a silent provider switch. There is one active local room question at a time; different people can run their own agents concurrently.

Only the question, explicit reply ancestors (up to 16 messages / 48 KB), PR identity, pinned base/head, current file and selected-line excerpt are supplied. The agent reads additional repository files only as needed. Reply to a message when its discussion should be included; a new top-level question does not inherit the entire room. Private CLI sessions are never imported. Only visible answer text is shared, not raw tool output or private reasoning.

Code excerpts come from exact Gitea revisions, including the old side of a diff. Outdated selections require a PR refresh before sending. Local checkout changes are reported in the prompt; no branch is switched automatically.

## Delivery and recovery

Messages use immutable IDs, so retrying a send after a lost response does not duplicate it. Drafts survive renderer reload. The server persists messages and latest answer snapshots; clients poll incremental sequence cursors, so a reconnect catches up without replaying an agent invocation.

Partial/final answers are written to a local delivery outbox before upload. Failed uploads retry while that project's room is open, including after restart. A silent sender is marked disconnected after 90 seconds, preserving the last answer. An eventual answer from that same authenticated sender can still complete it. **Ask again** prepares a new explicit request; reconnecting never silently reruns a paid question. Do not disconnect the room account while an answer awaits delivery.

Presence is optional and expires after 20 seconds. It shares only the current path, PR head and viewed count while the panel is visible. Clicking a colleague's file works only on a matching revision. It does not copy viewed marks, change their selection, or approve anything in Gitea.

## Experimental scope

This implements shared review discussion and read-only agent questions. It does not implement collaborative code editing, patch proposals, automatic branch synchronization, team SSO, server-side Gitea authorization, or continuous full-repository replication. Existing local editing and explicit Codex fix handoffs remain available separately.

Implementation references: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Codex permissions](https://learn.chatgpt.com/docs/permissions), [Claude CLI](https://code.claude.com/docs/en/cli-reference). These interfaces are version-sensitive; run the integration tests and provider smoke checks when updating either CLI.
