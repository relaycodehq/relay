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

Source layout: `electron/` owns credentials, API calls, disk and process access; `shared/` defines IPC validation and types; `src/` owns the UI; `src/vendor/t3code/` contains the attributed upstream components; `tests/` covers API/state boundaries and desktop flows. There is no demo mode in the shipped app.

## Releases and automatic updates

Every push to `main` runs `.github/workflows/release.yml`. It tests, builds macOS (arm64 `.dmg` and `.zip`), Windows (x64 NSIS installer) and Linux (x86-64 AppImage and the Omarchy bundle), and publishes them as `v<major>.<minor>.<run number>` to the public [relay-releases](https://github.com/lubomirmolin/relay-releases) repository, together with `latest.json`. The source repository stays private. Publishing needs a `RELEASES_TOKEN` secret: a fine-grained token with *Contents: read and write* on `relay-releases` only. To bump the major or minor version, change `version` in `package.json`.

Installed apps fetch `latest.json` every four hours (`electron/updater.ts`). When a newer version is out, an **Update** button appears in the sidebar footer. It downloads the file for the current install, checks its SHA-512, and switches over on **Restart**:

- **macOS**: unzips the new `Relay.app` and swaps it in after the app quits. This needs no Apple signing, but Relay must live in a writable folder rather than a translocated download.
- **Windows**: runs the NSIS installer silently, which then restarts Relay.
- **Omarchy**: runs the bundled `install.py` over the existing install.
- **AppImage**: replaces the AppImage file.

Development builds never check. Set `RELAY_UPDATE_FEED` to a feed URL to exercise the flow; plain HTTP is only accepted from `127.0.0.1`.

## Release status

This is an implemented and locally tested first release, not a claim of production certification. Before distributing broadly: verify the real private Gitea review flow, run Linux desktop tests on the target distribution, validate a real interactive Codex launch, and configure Developer ID signing/notarization. Multi-account switching, browser SSO, merge controls, image previews, and an embedded terminal are not included.

T3 Code provenance and its MIT license are in `THIRD_PARTY_NOTICES.md`.

