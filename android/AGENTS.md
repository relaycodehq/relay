# Relay for Android (native)

A from-scratch Kotlin + Jetpack Compose rewrite of the Expo phone app in
`../mobile`. Goal: 1:1 feature parity with it, a HextaUI-inspired look that
differs from the Expo app. It talks to the desktop over the same encrypted
bridge, so the desktop needs no changes.

Specs (read the ones your task touches before writing code):
- `docs/protocol.md`: byte-exact bridge protocol, every method and event.
- `docs/parity-checklist.md`: every feature of the Expo app, with source refs.
- `docs/design-hextaui.md`: design tokens and component look. Screenshots in
  `/tmp/hextaui/*.png`.
- `docs/stack.md`: library choices and versions.
When the spec and the TS source disagree, the TS source wins (`../shared`,
`../mobile/src`, `../electron/remote`).

## Build

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=$HOME/Library/Android/sdk
./gradlew :app:compileDebugKotlin      # fast check
./gradlew :app:testDebugUnitTest       # JVM unit tests
./gradlew :app:assembleDebug
```
Other threads may run Gradle at the same time; never kill gradle daemons you
didn't start, never `pkill` by pattern. Don't run the Android emulator unless
your task says so.

## Where code goes (package `dev.relay.android`)

- `remote/` the bridge: crypto, wire, client, routes, models, credentials,
  delta patches, outbox, drafts, offline cache. No Compose in here.
- `ui/` design system: theme/tokens and building blocks that know no feature
  (Button, Card, ListGroup, Badge, Sheet, Tabs, TextField, Toast, Skeleton...).
- `lib/` helpers that know no feature.
- `features/<name>/` one folder per feature (screen + its ViewModel + its
  pieces): `pairing`, `home`, `thread`, `composer`, `newthread`, `settings`,
  `project`, `git` (changes/branches/history/commit/diff/turn/merge),
  `files`, `tasks`, `subagents`, `images`, `markdown`, `renders`,
  `dictation`, `readaloud`, `notifications`, `updates`.
- `app/` the shell: Activity, AppContainer (manual DI), navigation, adaptive
  layout. Features never import `app/`; `ui/`, `lib/` and `remote/` never
  import `features/`.

## Rules

- Kotlin 2.4, Compose BOM, Material 3 underneath but every visible component
  styled through `ui/` (HextaUI tokens): hairline borders, 13sp body, radius
  12.8, greyscale with colour only for status. No pill/chip badges as
  decoration (user dislikes pills); outline badges sparingly.
- State: ViewModel + StateFlow, `collectAsStateWithLifecycle`. Manual DI via
  `AppContainer`. Navigation 3 with a typed back stack.
- Edge-to-edge with `WindowInsets.safeDrawing`, IME with `imePadding()`.
  Foldable (Galaxy Z Fold7): list-detail on wide screens.
- Endless animations step or stop when the app isn't in front.
- Comments only where they add something. No god files (split past ~600 lines).
- Unit tests where they pin real behaviour (crypto vectors, patches, parsing),
  not for coverage.
