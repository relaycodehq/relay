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

`package:omarchy` builds the Linux x86-64 directory and wraps it with the user installer, instructions and a SHA-256 checksum. After an existing Linux build, `python3 scripts/package-omarchy.py` only creates the bundle. `python3 -m unittest discover -s tests/packaging -v` checks install/update/removal and failure recovery using isolated directories. These checks can run on macOS; they do not establish Omarchy runtime compatibility.

`npm run test:setup` installs a pinned Angular/TypeScript toolchain solely for isolated language-service tests. It is not bundled with the app.

`npm run test:e2e` runs the real Electron renderer against an isolated local Gitea fixture, with native windows hidden and activation suppressed. It does not steal desktop focus, open Keychain prompts, or call your private server. The test launcher uses synthetic credential storage; the shipped app always uses its real OS storage. Native window-focus tests require an explicit `RELAY_TEST_HEADED=1`, and OS credential integration requires `RELAY_TEST_NATIVE_STORAGE=1`; leave both unset for normal runs. Linux CI runs under Xvfb in `.github/workflows/checks.yml` for pull requests and branches.

Source layout: `electron/` owns credentials, API calls, disk and process access; `shared/` defines IPC validation and types; `src/` owns the UI (`app/` the shell, `features/<name>/` one folder per feature, `ui/` shared building blocks, `lib/` helpers); unit tests sit next to the code they cover, and `tests/` holds the desktop flows, fixtures and a few cross-cutting unit tests. There is no demo mode in the shipped app.

## Releases and automatic updates

A release is an annotated `v<major>.<minor>.<patch>` tag on `main`; pushing to `main` alone ships nothing. The tag's message is the changelog friends read in Settings → About and on GitHub. `scripts/tag-release.sh log` lists what landed since the last tag, and `scripts/tag-release.sh <notes.md> [version]` tags `origin/main` with those notes and pushes the tag; the version defaults to the last tag's patch plus one.

Tags are built on a Mac mini (`scripts/mini-ci/`), not GitHub Actions. A launchd job checks for a new `v*` tag every minute and runs `release.sh` niced, with each step's parallelism capped: it refuses a lightweight tag, a tag off `main` or one not newer than the latest release, then tests, builds macOS (arm64 `.dmg` and `.zip`), Windows (x64 NSIS installer, made on macOS) and Linux (x86-64 AppImage and the Omarchy bundle, in an x64 Docker container), rebuilds the APK only when the phone app's native side changed, and publishes them under the tag's version to the public [relay-releases](https://github.com/lubomirmolin/relay-releases) repository, together with `latest.json`. The source repository stays private. Publishing reads a fine-grained token with *Contents: read and write* on `relay-releases` only from `~/.config/relay-ci/releases-token` on the mini.

Each build reports on the tagged commit as the `Release` commit status, which GitHub and Relay's CI indicator show: pending while it builds, then a link to the release, or on failure to its log in the `ci-logs` draft release (drafts are visible to collaborators only). The token also needs *Commit statuses: read and write* on this repository for that.

`scripts/mini-ci/install.sh` copies the scripts over and reloads the job. Build logs are in `~/relay-ci.noindex/logs`; a failed tag isn't retried until `~/relay-ci.noindex/state/failed` is deleted or the tag moves to another commit. `release.sh <vX.Y.Z> --dry-run` builds without publishing.

Installed apps fetch `latest.json` every four hours (`electron/app/updater.ts`). When a newer version is out, an **Update** button appears in the sidebar footer. It downloads the file for the current install, checks its SHA-512, and switches over on **Restart**:

- **macOS**: unzips the new `Relay.app` and swaps it in after the app quits. This needs no Apple signing, but Relay must live in a writable folder rather than a translocated download.
- **Windows**: runs the NSIS installer silently, which then restarts Relay.
- **Omarchy**: runs the bundled `install.py` over the existing install.
- **AppImage**: replaces the AppImage file.

Development builds never check. Set `RELAY_UPDATE_FEED` to a feed URL to exercise the flow; plain HTTP is only accepted from `127.0.0.1`.

## Release status

This is an implemented and locally tested first release, not a claim of production certification. Before distributing broadly: verify the real private Gitea review flow, run Linux desktop tests on the target distribution, validate a real interactive Codex launch, and configure Developer ID signing/notarization. Multi-account switching, browser SSO, merge controls, image previews, and an embedded terminal are not included.

