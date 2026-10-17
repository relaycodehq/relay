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
```

`swift test` checks the Swift bridge against vectors the desktop's TS made
(`Tests/RelayRemoteTests/Fixtures`, the same as Android's TsVectors.kt).
The live test pairs with the real bridge under Node:

```
node_modules/.bin/jiti ios/scripts/live-desktop.ts /tmp/pair.txt &   # from the repo root
RELAY_PAIR_URL_FILE=/tmp/pair.txt swift test --filter LiveBridgeTests
```

`--seed` gives that stand-in desktop sample threads that answer what the
phone sends; the Simulator shares this computer's network, so
`xcrun simctl openurl <sim> "$(cat /tmp/pair.txt)"` pairs it. Use a
simulator of your own (`xcrun simctl create`), headless; Maestro drives it.
Maestro's iOS driver listens on localhost:22087 for every simulator, so with
several running its taps land on whichever holds the port: drive parallel
sims with `axe --udid <sim>` instead.
Kill the stand-in by its PID.

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
