# Development and releases

## Build and test

Use Node.js 22+ and npm.

```sh
npm ci
npm run dev
```

```sh
npm run build
npm run test:setup
npm test
npm run test:e2e
npm run package:mac
npm run package:win
npm run package:linux
npm run package:omarchy
```

`npm run dev` in the main checkout runs Relay from it and can switch it to any of its worktrees, on the same data: `npm run dev:switch` lists them, `npm run dev:switch -- <branch or folder>` switches and `-- main` goes back, as does quitting a worktree's Relay. The sidebar footer has the same menu in dev. Agents carry on in their host across a switch; restoring closes those sessions before replacing their data. Before each one, Relay's records (`state.json`, `project-chats`, local storage) are cloned into `Dev snapshots` in its data folder, the last eight kept; `npm run dev:switch -- --restore [name]` puts one back. A name must be exact or an unambiguous prefix; restore backups share the eight-snapshot limit. Restoring requires the running app to be ready and to include current dev-switch support. A worktree needs its own `node_modules` or a link to the main checkout's.

Switching and restoring ask Relay to quit over IPC on macOS, Linux and Windows. Choosing **Keep editing** or **Keep open** cancels the request and keeps the current app and dev server running; there is no forced quit timer. Worktrees must include the current dev-switch support (rebase older branches first). Restore removes saved-data files absent from the snapshot too, after backing up everything it replaces; caches and models are left alone.

`package:omarchy` builds the Linux x86-64 directory and wraps it with the user installer, instructions and a SHA-256 checksum. After an existing Linux build, `python3 scripts/package-omarchy.py` only creates the bundle. `python3 -m unittest discover -s tests/packaging -v` checks install/update/removal and failure recovery using isolated directories. These checks can run on macOS; they do not establish Omarchy runtime compatibility.

`npm run test:setup` installs a pinned Angular/TypeScript toolchain solely for isolated language-service tests. It is not bundled with the app.

`npm run test:e2e` runs the real Electron renderer against an isolated local Gitea fixture, with native windows hidden and activation suppressed. It does not steal desktop focus, open Keychain prompts, or call any real server. The test launcher uses synthetic credential storage; the shipped app always uses its real OS storage. Native window-focus tests require an explicit `RELAY_TEST_HEADED=1`, and OS credential integration requires `RELAY_TEST_NATIVE_STORAGE=1`; leave both unset for normal runs. Linux CI runs under Xvfb in `.github/workflows/checks.yml` for pull requests and branches.

Source layout: `electron/` owns credentials, API calls, disk and process access; `shared/` defines IPC validation and types; `src/` owns the UI (`app/` the shell, `features/<name>/` one folder per feature, `ui/` shared building blocks, `lib/` helpers); unit tests sit next to the code they cover, and `tests/` holds the desktop flows, fixtures and a few cross-cutting unit tests. There is no demo mode in the shipped app.

## Releases and automatic updates

A release is an annotated `v<major>.<minor>.<patch>` tag on `main`; pushing to `main` alone ships nothing. The tag's message is the changelog friends read in Settings → About and on GitHub. `scripts/tag-release.sh log` lists what landed since the last tag, and `scripts/tag-release.sh <notes.md> [version]` tags `origin/main` with those notes and pushes the tag; the version defaults to the last tag's patch plus one.

Tags are built on a Mac mini (`scripts/mini-ci/`), not GitHub Actions. A launchd job checks for a new `v*` tag every minute and runs `release.sh` niced, with each step's parallelism capped: it refuses a lightweight tag, a tag off `main` or one not newer than the latest release, then tests, builds macOS (arm64 `.dmg` and `.zip`), Windows (x64 NSIS installer, made on macOS) and Linux (x86-64 AppImage and the Omarchy bundle, in an x64 Docker container), rebuilds the APK only when the phone app's native side changed, and publishes them under the tag's version to this repository's [releases](https://github.com/relaycodehq/relay/releases), together with `latest.json`. Publishing reads a fine-grained token, limited to this repository, with *Contents* and *Commit statuses* read and write, from `~/.config/relay-ci/releases-token` on the mini.

`latest.json` is signed. `scripts/sign-update-feed.mjs` signs its exact bytes with the Ed25519 private key at `~/.config/relay-ci/update-signing-key.pem` on the mini (PKCS#8 PEM) and writes the base64 signature as `latest.json.sig`, which goes up together with `latest.json`. Installs only accept a feed signed by one of the public keys in `updateKeys` (`shared/updates.ts`), so the releases token alone can't ship code. `release.sh` checks the key before building and stops if it's missing or not pinned; `--dry-run` skips signing when there's no key. Keep an offline backup of the key: losing it means no install can update to a release signed by anything else, and they'd all have to be reinstalled by hand. To rotate, make a new pair (`openssl genpkey -algorithm ed25519`), add its raw public key in base64 to `updateKeys` next to the old one, and release with the old key; once that release is out, put the new key on the mini, and a later release can drop the old one from the list. Installs that skipped the release adding the new key only know the old one; `latest.json.sig` may hold one signature per line, so signing with both keys for a while keeps them updating. Installs older than the first signed release ignore the `.sig`.

Each build reports on the tagged commit as the `Release` commit status, which GitHub and Relay's CI indicator show: pending while it builds, then a link to the release, or on failure to its log in the `ci-logs` draft release (drafts are visible to collaborators only). The token also needs *Commit statuses: read and write* on this repository for that.

`scripts/mini-ci/install.sh` copies the scripts over and reloads the job. Build logs are in `~/relay-ci.noindex/logs`; a failed tag isn't retried until `~/relay-ci.noindex/state/failed` is deleted or the tag moves to another commit. `release.sh <vX.Y.Z> --dry-run` builds without publishing.

Installed apps fetch `latest.json` every four hours (`electron/app/updater.ts`). When a newer version is out, an **Update** button appears in the sidebar footer. It first checks `latest.json.sig` and refuses a feed that's unsigned or signed by a key it doesn't know, then downloads the file for the current install, checks its SHA-512 against the signed feed, and switches over on **Restart**:

- **macOS**: unzips the new `Relay.app` and swaps it in after the app quits. This needs no Apple signing, but Relay must live in a writable folder rather than a translocated download.
- **Windows**: runs the NSIS installer silently, which then restarts Relay.
- **Omarchy**: runs the bundled `install.py` over the existing install.
- **AppImage**: replaces the AppImage file.

Development builds never check. Set `RELAY_UPDATE_FEED` to a feed URL to exercise the flow; plain HTTP is only accepted from `127.0.0.1`. Such a feed still needs a `.sig`; a development build (never a packaged one) also trusts the public key in `RELAY_UPDATE_KEY`, so a test feed can be signed with a throwaway key (`node scripts/sign-update-feed.mjs latest.json --key <pem> --pinned <public key>`).

## Release status

Relay is early software. Builds are ad-hoc signed rather than signed with an Apple Developer ID and notarized, so macOS asks before opening them the first time. Linux desktop builds are cross-built on macOS and tested less than the Mac build.
