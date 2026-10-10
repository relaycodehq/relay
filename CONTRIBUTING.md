# Contributing to Relay

Relay is an early preview. Bug reports, focused fixes, documentation and platform
testing are welcome.

**For vulnerabilities, follow [SECURITY.md](SECURITY.md). Please keep exploit
details out of public issues and pull requests.**

## Bugs and ideas

Search [existing issues](https://github.com/relaycodehq/relay/issues) before opening
one, then use the bug report or feature request form. For bugs, include your Relay
version, OS, agent and permission mode where relevant, and the shortest steps that
reproduce the problem. Use sample projects and redact logs and screenshots; they
can contain private source, prompts, file paths and credentials.

For a substantial feature or architectural change, open an issue to discuss the
problem and approach before investing in a large pull request. Questions can go
to [hello@relaycode.io](mailto:hello@relaycode.io).

## Run locally

You need Node.js 22+, npm and Git. Fork the repository, clone your fork and create
a branch for your change, then run:

```sh
npm ci
npm run dev
```

Sign in to an agent only if your change needs real agent integration. Agents can
execute commands and edit files, so use a disposable sample project for testing
those flows. Development runs use local Relay data; see
[development and releases](docs/development.md) for snapshots and worktree
switching.

For phone changes, read [mobile/AGENTS.md](mobile/AGENTS.md) and the
[phone development guide](docs/phone.md). The Expo app has its own dependencies
and checks in `mobile/package.json`.

## Code layout and conventions

Read [AGENTS.md](AGENTS.md) before editing. The main boundaries are:

- `src/features/<name>/`: a feature's UI, hooks, styles and helpers together.
- `src/app/`: the application shell; `src/ui/` and `src/lib/`: feature-independent
  building blocks and helpers.
- `electron/<feature>/`: main-process services, process access, credentials and
  disk operations. Only `main.ts` and `preload.ts` live at the top level.
- `shared/`: types, validation and logic shared by desktop, phone and headless
  Relay. No DOM or Node globals, or imports from platform-specific code.

Keep fixes at the shared cause, keep unrelated changes separate, and reuse
existing code and dependencies. Put unit tests beside the file they cover as
`<file>.test.ts`; desktop flows live in `tests/e2e/`. Use
`scripts/move-files.mjs` for file moves as described in AGENTS.md.

Changes to agent permissions, IPC, remote calls, credentials or cryptography need
particular care: preserve validation and authorization, explain the security
boundary affected, and test relevant failure cases. New Electron calls reachable
from the phone or headless Relay need a headless implementation too.

## Check your change

Run checks that cover the behavior you changed. For code changes:

```sh
npm run typecheck
npm run format:check
npm test -- path/to/changed-file.test.ts
```

`npm run typecheck` checks the separate renderer, main-process, preload and test
projects. A bare `tsc --noEmit` does not check this repository. Format changed code
with the installed Prettier when needed. For documentation and issue forms, check
formatting with Prettier directly and verify their links; `format:check` covers
code.

Before running the whole unit suite or desktop flows, install the isolated
language-toolchain fixture:

```sh
npm run test:setup
npm test
```

For desktop interaction changes, build and run the relevant Playwright spec:

```sh
npm run build
npm run test:e2e -- tests/e2e/relevant-flow.spec.ts
```

Desktop tests use isolated local fixtures and synthetic credential storage. Leave
`RELAY_TEST_HEADED` and `RELAY_TEST_NATIVE_STORAGE` unset for normal runs. Check
visual changes in the actual UI and include a screenshot or short recording in
your PR. Headless service changes also need `npm run build:headless`; installer
changes have Python checks in `tests/packaging/`. See
[development and releases](docs/development.md) and
[the CI workflow](.github/workflows/checks.yml) for the full checks.

## Send a pull request

Target `main` with a small, focused change. Explain the problem, the resulting
behavior and how you checked it. Link the relevant issue and call out any checks
you could not run, platform limitations, or changes to saved data. Add a
regression test when it catches a meaningful failure; documentation-only changes
do not need application tests.

AI-assisted contributions follow the same standard: review the generated diff,
understand what it does and verify it yourself. Never include credentials,
private conversations or unrelated local files.

Maintainers handle releases through annotated `v*` tags on `main`; pushing a
commit alone does not ship a release. Contributions are under the project's
[MIT license](LICENSE).
