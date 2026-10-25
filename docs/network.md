# What Relay sends over the network

Relay has no analytics, crash reporting or tracking library. This page lists
every host Relay's own code names, and what for. `tests/unit/network-hosts.test.ts`
fails when the code names a host that isn't in one of the tables below, or a
table names one the code no longer does, so this list can't quietly fall
behind.

Hosts that come from you aren't in the code, so they aren't listed one by
one: your Git remotes (Relay fetches when you pull, rebase or hand a thread
off), a Gitea or GitHub Enterprise server you sign in to, your Azure DevOps
organization, and the computers and phones you pair.

## On its own

| Host | What, and when | Turning it off |
| --- | --- | --- |
| `ping.relaycode.io` | Once a UTC day, "a copy of Relay is in use": `{ kind, version, platform }` and nothing else, no ID. The [Worker](../ping/worker.js) counts it and keeps no address. `electron/app/daily-ping.test.ts` pins the body to those three keys. | **Count me as a user** in Settings → About, `relay settings set usage-ping off`, `"usagePing": false` in settings.json, or `DO_NOT_TRACK=1` |
| `github.com` | Update check: downloads the latest release's `latest.json` 15s after launch and every 4h. A plain download; nothing is sent. | Builds from source don't check. A headless Relay with auto-update off still checks, but only says an update is out. |
| `registry.npmjs.org` | Every few hours, the newest version of each installed agent, to offer updates. | **Agent update checks** in Settings → Agents |

## When you use a feature

| Host | What, and when |
| --- | --- |
| `api.github.com` | Pull requests and CI checks, with your `gh` sign-in; the changelog in Settings → About. Also looks up the latest rust-analyzer or clangd release, the first time you open a Rust or C++ file without it installed; the program itself downloads from `github.com`. The TypeScript, PHP and Python language servers are installed by your own `npm`, from whatever registry it is set to. |
| `huggingface.co` | Dictation and read-aloud models, downloaded when you turn either on. Dictation's voice detector comes from `github.com`. |
| `chatgpt.com`, `auth.openai.com` | Codex usage limits on the Usage page and in the picker, with your Codex ChatGPT sign-in. |
| `cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.googleapis.com`, `oauth2.googleapis.com` | Antigravity usage limits, with your Antigravity sign-in. |
| `dl.google.com` | Installing Antigravity. |
| `dev.meta.ai` | Installing Muse Code. |
| `cdn.agentclientprotocol.com` | The ACP agent registry and its icons, when you browse it. |
| `open-vsx.org` | Importing a VS Code theme. |
| `api.clockify.me`, `euc1.clockify.me`, `euw2.clockify.me`, `use2.clockify.me`, `apse2.clockify.me` | The Clockify plugin, on the region you pick. |
| `openrouter.ai` | The DevOps plugin's filter, with your OpenRouter key. |
| `dev.azure.com`, `org.visualstudio.com` | Azure DevOps pull requests and work items, on your organization. |
| `cdn.jsdelivr.net` | Pages an agent shows in a thread may load libraries from public CDNs like this one. |

## Named in the code, never contacted by Relay

| Host | Why it's there |
| --- | --- |
| `relaycode.io`, `tailscale.com`, `cli.github.com`, `aka.ms`, `opencode.ai`, `play.google.com` | Download links and install commands shown to you. |
| `claude.ai`, `antigravity.google.com` | Links to each provider's own usage page. |
| `ui.perfetto.dev`, `creativecommons.org`, `agentclientprotocol.com` | Links in messages, licences and comments. |
| `knowyourmeme.com`, `i.imgflip.com`, `i.kym-cdn.com`, `tenor.com` | Where an agent may download a meme's picture from, in a thread. |
| `api.openai.com`, `git-lfs.github.com`, `github.com.helper`, `www.apple.com` | Names inside other things: sign-in token claims, the Git LFS pointer header, a Git config key, a plist's DTD. |

## Not Relay's

The agents Relay runs (Claude Code, Codex, OpenCode and the rest) talk to
their providers and send whatever telemetry those tools send, under their own
settings. Relay doesn't add to it, and doesn't switch it off for you; see each
agent's documentation.
