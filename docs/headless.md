# Headless Relay

`relay` is Relay without its window, for a computer you only ever reach from somewhere else: a Mac mini in a cupboard, a Linux box, a cloud server. Set it up once and it runs in the background, starts with the computer and keeps your agents working there. You start, follow and answer threads from the Relay phone app, and hand threads to it (and take them back) from Relay on your laptop.

It is the desktop's own code, so threads, worktrees, approvals, questions, queues, Relay's tools for agents, usage and handoffs behave as they do on the desktop. The terminal is only for setting it up and checking on it; it is not a terminal UI for the work.

## Install

You need **Node.js 22 or newer**, **Git**, **[Tailscale](https://tailscale.com)** signed in to the same tailnet as your phone and laptop, and at least one agent CLI signed in as the user Relay runs as: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude auth login`), [Codex](https://github.com/openai/codex) (`codex login`) or [OpenCode](https://opencode.ai) (`opencode auth login`).

```console
curl -fsSL https://relaycode.io/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://relaycode.io/install.ps1 | iex
```

That's the whole setup: the installer puts the newest release in `~/.local/share/relay` and `relay` in `~/.local/bin`, adds that to your shell's PATH, and runs `relay setup`. On Windows it goes to `%LOCALAPPDATA%\Programs\Relay Headless`, with its `bin` on your PATH, beside the desktop app rather than over it. The installer and updater verify the feed's signature with Relay's release key before accepting its download URL and SHA-512, then check the archive against that hash.

It looks for a Node.js that actually runs, so a Homebrew `node` broken by an upgrade doesn't stop it while a `node@22` beside it works, and Relay keeps using the one it found. `RELAY_NODE` picks one yourself, `RELAY_INSTALL` and `RELAY_BIN` move the install, `RELAY_VERSION=0.9.1` installs that release instead, `RELAY_NO_SETUP=1` leaves `relay setup` for later and `RELAY_NO_MODIFY_PATH=1` leaves your shell's startup file alone. Run it again to reinstall. One archive serves macOS, Linux and Windows: nothing in it is native.

`relay setup` checks Node, Git, Tailscale and the agents, sets Relay up to start with the computer, offers to add the folder you run it in as a project, and shows a code to pair your phone.

## Next to the desktop app

The desktop app has its own `relay`: **Relay → Install "relay" Command…** writes one to `~/.local/bin` that opens a folder in the app (`relay .`, or `relay` alone to bring the app up) and hands every other command to the headless Relay when it's installed too. The installer leaves that one in place.

## Pair a phone or a computer

```console
relay pair
```

prints a QR code and a link, and waits until something pairs:

- **Phone:** scan the code with the Relay app.
- **Laptop:** in Relay on the laptop, open **Settings → Computers** and paste the link. The laptop can then hand threads to this computer from a thread's header, and bring them back from the strip that shows where the thread is. A thread only goes to a computer that has its repository cloned and added as a project (`relay projects add <folder>`).

A code works once, for ten minutes. `relay devices` lists what's paired; `relay devices remove <name>` disconnects one at once.

## Settings

```console
relay settings
```

In a terminal it's a menu of what the desktop's Settings would set: the name and port, installing updates by themselves, keeping the computer awake, when quiet threads settle and settled worktrees go, which agent new threads start with, each agent CLI's path (or let Relay find it), Git, and Claude's "Flag what I'd miss". It also sets up what a phone uses this computer for:

- **Dictation.** Downloads the speech engine and the 671 MB model, then phones dictate with this computer as they would with a desktop.
- **Read aloud.** Downloads onnxruntime and a voice (Pocket TTS or Supertonic 3); choose the voice and speed there too.
- **Cursor.** Downloads Cursor's SDK and shows a sign-in link and its QR code: open it on your phone or laptop, sign in, and this computer is signed in.
- **Gitea.** Signs in with your server and an access token, for CI status and pull request threads.

The speech engines come from npm, each checked against the SHA-512 Relay's lockfile pins, into `~/.relay/runtime`; an update that moves them on fetches them again by itself. From a script, `relay settings set <key> <value>` changes one (`relay settings` lists the keys), and `relay settings dictation install`, `relay settings read-aloud install [engine]`, `relay settings cursor sign-in` and `relay settings gitea sign-in <server>` (the token on stdin) set the rest up. `relay settings --json` prints them all.

## Commands

| Command | |
| --- | --- |
| `relay setup` | Check this computer, start Relay with it, pair a phone. `--no-service`, `--no-pair`, `--project <folder>`, `--yes` skip the questions. |
| `relay pair` | Show a code for a phone or another computer. `--json` prints the link instead. |
| `relay <folder>` | On a Mac, open the folder in Relay's desktop app, as a project (`relay .`). A word that is also a command runs the command; `relay ./logs` opens the folder. |
| `relay status` | Whether it runs, where it's reached, what's paired, threads working or waiting on you, agents and their sign-in, updates. |
| `relay start` / `stop` / `restart` | `stop` refuses while threads are working unless `--force`; `restart` leaves running agents to carry on. |
| `relay logs [-f] [-n <lines>]` | The log, `~/.relay/logs/relay.log`. |
| `relay projects [add <folder> \| remove <name>]` | Removing hides a project; its folder, threads and worktrees stay, and adding it again brings them back. |
| `relay threads` | Open threads and what each is doing, including those handed over to or from another computer. |
| `relay devices [remove <name>]` | Paired phones and computers. |
| `relay settings [set <key> <value>]` | See and change settings, set up dictation, read aloud, Cursor and Gitea; see above. |
| `relay service install \| uninstall \| status` | Start Relay with the computer, or stop doing so. |
| `relay update [--check]` | Install the newest release now; agents keep working through the restart. |
| `relay run [--supervise]` | Run in the foreground, as the service does; `--supervise` starts it again after a crash, as Windows' Startup script runs it. |

`--home <folder>` (or `RELAY_HOME`) runs a Relay with its data elsewhere, `--port <number>` changes the port phones and computers connect to (default 47821), and `--name <name>` what they call this computer (default: its host name). `--port` and `--name` are kept in `~/.relay/headless.json` for every start after. Most commands take `--json`.

## How it runs

- **In the background.** `relay setup` and `relay service install` write a launchd agent (`~/Library/LaunchAgents/io.relaycode.relay.plist`) on macOS, a systemd user service (`~/.config/systemd/user/relay.service`) on Linux, or a script in your Startup folder (`Relay.vbs`) on Windows. Each starts Relay at login (with lingering on Linux, at boot) and again after a crash, but not after `relay stop`. On Linux, `sudo loginctl enable-linger <you>` keeps it running when you log out, if setup couldn't turn that on itself. Windows starts it when you sign in, hidden; on a PC nobody signs in to, turn on automatic sign-in for the account. Without a service, `relay start` runs it until the computer restarts.
- **Agents outlive Relay.** Agents run in the agent host, as on the desktop, which carries on through `relay restart`, an update or the service restarting it; Relay picks their sessions back up when it starts. `relay stop --force` ends them.
- **Awake while it matters.** Like the desktop, it keeps the computer from idling to sleep (`caffeinate` on macOS, `systemd-inhibit` on Linux, `SetThreadExecutionState` on Windows), since a sleeping computer drops off Tailscale and a phone can't wake it.
- **Up to date by itself.** It looks for a new release every four hours, as the desktop does. With "Install updates automatically" on (the default; `relay setup` asks, `relay settings set auto-update off` turns it off) it downloads it, checks it against the release's SHA-512 and installs it once no thread is working, or after six hours at most, since agents carry on through the restart anyway. With it off, `relay status` and the log say a release is out and `relay update` installs it. Either way it can be updated from elsewhere: the laptop's **Settings → Computers** shows its version with an update button, and a phone newer than it offers to update it. A build from source updates with `git pull` instead.
- **One folder.** Threads, settings, keys, speech models and logs live in `~/.relay`, separate from a desktop Relay's data, so both can run on one computer (give one of them another `--port`).
- **Images arrive whole, but smaller.** A desktop scales images down for a phone; without a graphics library this one sends them at full size, and re-encodes an opaque PNG (a screenshot, mostly) as a JPEG when that saves at least a tenth. A full-screen screenshot goes from about 4 MB to about half a megabyte. Transparent PNGs and JPEGs go as they are.

## Security

- **Tailscale only**, as on the desktop: the bridge listens on this computer's tailnet address alone and drops connections from anywhere else. Pairing, the device tokens and the Noise-style encryption are the desktop's; see [Phone app](phone.md#how-it-works).
- **Secrets without a keychain.** A server has no Keychain or Secret Service to ask, so the bridge's private key, paired computers' tokens and plugin secrets are sealed with AES-256-GCM under `~/.relay/secret.key`, which only your user can read (0600, or your profile's own permissions on Windows), as SSH keeps its keys. Anyone who can read your home folder can read them; so can they your agents' own sign-ins.
- **The `relay` command** talks to the running Relay through `~/.relay/relay.sock`, which only your user can open (a named pipe on Windows).

## What stays on a desktop

A phone can't start or steer these on a desktop Relay either, so a headless one doesn't add them: terminals, editing files, pull request review, and starting Deep reviews and Ultraplan councils (their threads show on the phone as usual). The phone wears its own theme, since a headless Relay has none to hand it.

## Build it yourself

```console
npm ci
npm run build:headless           # dist-headless/: relay.cjs and what it runs
node dist-headless/relay.cjs setup
npm run package:headless         # release/Relay-<version>-headless.tar.gz
```

`electron/headless/` is the whole difference: `cli.ts` is the command, `daemon.ts` starts the desktop's services the way `electron/main.ts` does, and `electron-stand-in.ts` is what `import … from "electron"` gives them in this build (paths, `fetch`, sealing secrets, utility processes and their message ports over Node's IPC; anything that needs a screen says it isn't available). A new Electron call in a service the phone or a handoff reaches needs an answer there too; `npm run build:headless` fails on a missing export. `tests/e2e/headless.spec.ts` pairs a phone and a desktop Relay with a headless one and hands a thread over and back; `headless-settings`, `headless-speech` and `headless-dictation` (with `RELAY_DICTATION_MODEL` set to a downloaded model) cover the rest.
