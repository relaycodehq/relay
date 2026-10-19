# Relay for iPhone (native)

SwiftUI, iOS 26+, Liquid Glass from the system components. Talks to the
desktop over the encrypted bridge, ported from the Kotlin app's `remote/`.
The bridge spec is `../android/docs/protocol.md`; when it and the desktop's
TS disagree, the TS wins (`../shared/remote*.ts`, `../electron/remote`).

## Layout

- `RelayKit/` Swift package, no UI, builds and tests on the Mac:
  `RelayRemote` is the bridge (crypto, wire, pairing links, routes, delta
  patches, models, `RemoteClient`).
- `Relay/` the app: `App/` (entry, root, settings), `Connection/` (the
  observable link to the active computer, Keychain pairings),
  `Features/<name>/` per screen.
- `project.yml` makes `Relay.xcodeproj` (`xcodegen` here); the project
  isn't committed.

## Build and test

```
cd ios/RelayKit && swift test                 # bridge tests, ~1s
cd ios && xcodegen && xcodebuild -project Relay.xcodeproj -scheme Relay \
  -destination 'generic/platform=iOS Simulator' build
# Native app tests, including image/Sites ownership regressions, are in RelayTests
# and are included in the Relay scheme. Use a simulator of your own:
cd ios && xcodegen && xcodebuild -project Relay.xcodeproj -scheme Relay \
  -destination 'platform=iOS Simulator,id=<sim>' test
```

`swift test` checks the Swift bridge against vectors the desktop's TS made
(`Tests/RelayRemoteTests/Fixtures`, the same as Android's TsVectors.kt).
**On the user's iPhone: `ios/scripts/device.sh`, nothing else.** No
arguments. It finds the phone, signs with whatever profile works, installs
Debug and launches it with Show touches on. Don't run `xcodebuild` with a
team, don't send the user to Xcode › Accounts or to Trust, and don't
mention signing or accounts at all. If the script fails, fix the script.

The live test pairs with the real bridge under Node:

```
node_modules/.bin/jiti ios/scripts/live-desktop.ts /tmp/pair.txt &   # from the repo root
RELAY_PAIR_URL_FILE=/tmp/pair.txt swift test --filter LiveBridgeTests
```

`--seed` gives that stand-in desktop sample threads that answer what the
phone sends; the Simulator shares this computer's network, so
`xcrun simctl openurl <sim> "$(cat /tmp/pair.txt)"` pairs it. Writing a thread's
title into `/tmp/pair.txt.send` sends into it as if typed on the desktop. Use a
simulator of your own (`xcrun simctl create`), headless; Maestro drives it.
Maestro's iOS driver listens on localhost:22087 for every simulator, so with
several running its taps land on whichever holds the port: drive parallel
sims with `axe --udid <sim>` instead.
Kill the stand-in by its PID.

## Working in the Simulator

Most of an iOS session goes into builds and waiting, not code. Measured on
2026-10-17: 35 builds took 24min of 88, fixed sleeps 9min, and a layout fix
placed by eye took five builds that one logged number would have saved.

- **One command to see a change:** `ios/scripts/sim.sh <sim> --wait "<label>"`
  builds, installs, opens without the splash and returns once that
  accessibility label is on screen (`--no-build` to relaunch only). No
  `sleep 12` after a launch: Relay is up within ~3s without the splash.
- **`RELAY_NO_SPLASH`** skips the launch animation
  (`SIMCTL_CHILD_RELAY_NO_SPLASH=1 xcrun simctl launch …`); the splash costs
  ~4s a launch.
- **xcodebuild prints `error: … failed with exit code 0 but produced no
  further output` on builds that worked.** Trust the exit status; don't
  build twice to make the line go away.
- **Hot reload instead of a rebuild** for a change inside function bodies
  (layout, text, colours, a view's `body`). InjectionLite is linked only
  when the project is generated with `RELAY_HOT_RELOAD=YES`, as `sim.sh`
  does (`hot-reload.yml`); a linked package ships in every configuration,
  so `device.sh` and release builds leave it out. In Xcode by hand,
  generate with that set first. Run a build made with `sim.sh` (it needs Xcode's own
  DerivedData, not `-derivedDataPath`, to find the build log), then save a
  `.swift` file; the console (`xcrun simctl launch --console-pty …`) says
  `Compiled in 1151ms` / `Hot reload complete`, and `hotReloads()` on the
  tab view draws everything afresh, each tab's stack kept. It can't take
  new stored properties, new types or files, or `project.yml` changes:
  rebuild for those. After a reload on a pushed screen the tab bar shows
  again (`TabBarDrop` starts over); go back and in. Simulator only.
- **Measure, then move things.** When something lands in the wrong place,
  log its frame (`onGeometryChange` + `print`, read with `--console-pty`)
  on the first build instead of tinting it and nudging. Toolbar items are
  hosted on their own: their `.global` frame counts from the nav bar, not
  the screen.
- **Look at full resolution for edges and lines.** A 900px screenshot hid a
  1px rule under the bar; crop the top of `xcrun simctl io <sim> screenshot`
  at full size (`ffmpeg -vf crop=…`) before calling a line gone.
- **Gestures:** `axe tap` and `axe swipe` for taps and scrolls, `axe drag`
  for anything that has to overscroll (pull to refresh); `axe swipe` never
  pulls a list past its top. Each `axe describe-ui` takes ~2s, so poll with
  a time limit, not a count.
- **Record motion** with `xcrun simctl io <sim> recordVideo` and a contact
  sheet (`ffmpeg -vf "fps=4,scale=200:-1,tile=8x2"`); start recording ~1.5s
  before the action, it starts late.
- **Check where the app opened.** It reopens the thread that was showing,
  so a relaunch may not be on the list your taps aim at.
- **The stand-in desktop gets new keys each start**, so a restart means
  pairing again (`xcrun simctl keychain <sim> reset`, `openurl` the link,
  Continue). Keep it running between checks; stop it by its PID.

## Rules

- `RemoteClient` is an actor on its own serial queue; socket callbacks land
  there in order, which the sealed frames' counters need. `Dial` and `Race`
  are only touched on that executor.
- Native components first: let the system draw the glass (bars, sheets,
  `.buttonStyle(.glass)`), no custom chrome copied from Android.
- No pill badges as decoration; muted text instead.

## System bugs we work around

Each with how to tell it's fixed, so the workaround can go.

- **Minimized search's ✕ doesn't reach SwiftUI (iOS 27).** With
  `.searchToolbarBehavior(.minimize)`, ✕ closes the field in UIKit only;
  `isPresented` stays true and the query keeps its text, so the bar opens
  again with the old text, or turns into an empty capsule nothing can be
  typed into. A bare `TabView` > `NavigationStack` > `List` with
  `.searchable(...).searchToolbarBehavior(.minimize)` shows it.
  `onSearchClosed` (`Relay/UI/SearchClosed.swift`) watches the field stop
  editing with `searchController.isActive` false and closes it in SwiftUI
  too. Fixed when that bare repro, with `isPresented` bound and logged, sees
  it go false on ✕ without the hook.
- **Search circle needs a stack per tab.** `Tab(role: .search)` opens into
  the bar's field only when each tab has its own `NavigationStack` and the
  `.searchable` sits on the search tab's content; inside one outer stack the
  field never opens, and `.searchable` on the `TabView` spreads to every tab.
- **The tab bar's glass is drawn by its group view.** Moving `UITabBar` shows
  nothing; `TabBarDrop` moves the `_UIBottomTabBarGroupView` through
  `bounds.origin.y` (its `transform` is UIKit's and jumps on a device).
- **Negative `additionalSafeAreaInsets` are ignored**, so a pushed screen
  can't give back the dropped tab bar's room that way; `overTabBar()` does it
  in SwiftUI.
- **The search circle is picked in UIKit before SwiftUI can refuse it.** New
  is a `Tab(role: .search)` whose pick the selection binding swallows to push
  New instead. UIKit switches to the circle for a moment anyway: the tab's
  root hears it's leaving with nothing pushed (so `TabBarDrop` also follows
  the stack's depth), and UIKit keeps the circle picked, so the next tap
  showed its empty page (`keepTabSelected` puts it back). Fixed when tapping
  New twice in a row works without either.
- **A row line split into views loops layout under a pushed screen.** An
  `HStack` of a fixed-size `Text` and a label as a `ThreadRow`'s second line
  spun the main thread at 100% once New was pushed over Projects. Keep that
  line one `Text`, pieces interpolated into it.
