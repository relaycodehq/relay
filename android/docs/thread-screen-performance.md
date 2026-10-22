# Android thread-screen performance investigation — 2026-10-20

Tested on the connected Xiaomi 2201116SG (veux), Android 13, 1080×2400, 120 Hz.
The installed app was a debuggable, unoptimized build. The phone reported thermal
status 0 during the comparison.

## What caused the lag

1. **Debug execution overhead was the largest navigation penalty.** On the same
   phone, optimized/non-debuggable code substantially reduced the long frames
   when switching tabs and opening New thread. The source already enables R8 for
   releases; the APK on this phone wasn't a release build.
2. **Running indicators kept Threads drawing at the display's full refresh rate.**
   A stationary screen with running threads produced about 117 frames/second.
   The shared animation helper used a continuously ticking infinite transition.
3. **Settings eagerly composed and measured its whole scrolling page.** Every
   visit built the offscreen app, computer, route and developer rows too.
   Making those sections lazy helped the debug build, but did not by itself
   remove the navigation stalls.
4. **Sideloaded baseline profiles had not been compiled.** The optimized install
   initially reported ART `status=verify`. Installing its existing bundled
   profile and running `speed-profile` compilation improved the next process's
   navigation further. ProfileInstaller and the library profiles were already
   present; no new dependency was needed.

System traces put long frames in `Recomposer:recompose` and
`AndroidOwner:measureAndLayout`. Ordinary GPU times were around 6–9 ms, much
shorter than the navigation stalls. This supports a CPU/composition/layout
bottleneck. Individual composable attribution wasn't available: the optional
Compose Perfetto SDK trace did not produce composition events on this device.
Method sampling was intrusive/unreliable here, and hardware-event simpleperf
sampling was denied by the device. Reported timings below use frame statistics
and low-overhead system tracing, not method-profiler timings.

## Changes

- `android/app/src/main/java/dev/relay/android/ui/Basics.kt`: update shared endless
  animations at 20 Hz, reading their state during drawing. Keep the existing
  foreground and reduced-motion gates. Elapsed monotonic time preserves animation
  speed when a callback is delayed.
- `android/app/src/main/java/dev/relay/android/features/settings/SettingsScreen.kt`:
  replace the eager scrolling Column with keyed lazy sections.

## Measurements

Each navigation run performed Projects → Settings → Threads → New thread three
times. Frame statistics were reset before each action and collected about 700 ms
after its tap. New thread included keyboard opening; Back hid the keyboard,
then returned home. Values are the **longest completed frame during each action,
not tap-to-content latency**.

Warm visits (second and third cycle), milliseconds:

| Destination | Debug before | Debug with source fixes | Optimized with fixes | Optimized + compiled profile |
| --- | ---: | ---: | ---: | ---: |
| Projects | 196 / 192 | 216 / 200 | 62 / 56 | 46 / 49 |
| Settings | 191 / 155 | 167 / 148 | 53 / 55 | 52 / 45 |
| Threads | 217 / 209 | 274 / 254 | 91 / 97 | 72 / 63 |
| New thread | 199 / 188 | 237 / 219 | 100 / 64 | 60 / 53 |

These are small, sequential samples against live data, not an isolated
Macrobenchmark. JIT warmup, CPU frequency and changes in the live thread list
add noise. In particular, **the source fixes alone did not solve debug navigation
jank**. Do not attribute the combined optimized-build improvement solely to them.
Earlier cold debug entries also produced roughly 300–500 ms frames. After
optimized/profiled process restart, first visits were 53 ms Projects, 57 ms
Settings, 82 ms Threads, and 114 ms New thread. A first-open hitch remains.

Stationary Threads, sampled final five-second trace windows:

| Metric | Debug before | Debug with 20 Hz loops |
| --- | ---: | ---: |
| Frames/second | 117 | 19.6 |
| UI-thread CPU, percent of one core | 71.2% | 34.5% |
| Render-thread CPU, percent of one core | 60.4% | 25.3% |

CPU figures are observed samples, not fixed power/battery guarantees. System
traces contained some vendor clock warnings; frame durations and these local
scheduler windows were usable. Screenshots confirmed the destination screens,
keyboard, and lazy Settings content after scrolling. Backgrounding the final
app produced zero app frames during a roughly one-minute observation; returning
it to the foreground resumed rendering.

## Validation and reproduction

- `:app:assembleDebug`, `:app:testDebugUnitTest` (311 tests, 0 failures), and an R8/minified,
  non-debuggable APK build passed. `git diff --check` passed.
- Installed and navigated the builds on the physical phone without uninstalling
  or clearing app data. Existing pairing remained usable. No messages were sent.
- Optimized test build: a temporary Gradle init script used
  `androidComponents.finalizeDsl` to create `benchmark`, copied `release`, set
  `signingConfig` to `debug`, and set `matchingFallbacks = ['release']`.
  This permitted replacing the existing development APK while preserving data.
  It is a local test APK, not a signed public release. No build variant or tracing
  dependency was added to the project. At the user’s request the optimized build
  is left installed, labelled with the checkout’s version `0.18.2` (code 18002),
  so it does not offer that same public version as an update. Its executable
  DEX files are identical to the measured optimized build. The profile was
  installed and compiled again after this final installation.
- The original APK included unmerged app-lock UI absent from this checkout.
  Its original APK was retained at `/tmp/relay-original.apk` for restoration
  (`adb install -r -d /tmp/relay-original.apk` also allows its older development
  version code).
- Temporary measurements and screenshots are under `/tmp/relay-*`; they were not
  added to the repository. An initial R8 build ran out of disk space; after
  removing investigation-generated intermediates and redundant traces, the
  optimized build passed.

To compile the existing bundled profile after a local optimized sideload:

```sh
adb shell am broadcast -a androidx.profileinstaller.action.INSTALL_PROFILE \
  -n dev.relay.android/androidx.profileinstaller.ProfileInstallReceiver
adb shell am force-stop dev.relay.android
adb shell cmd package compile -f -m speed-profile dev.relay.android
adb shell am start -n dev.relay.android/.MainActivity
```

The receiver returned 1 (success), compilation returned Success, and package
inspection confirmed `status=speed-profile`. This is a device-side test/setup
step, not a new runtime behavior shipped by these source changes.

Android's guidance: [Compose performance](https://developer.android.com/develop/ui/compose/performance),
[manual profile installation and measurement](https://developer.android.com/topic/performance/baselineprofiles/manually-create-measure),
[composition tracing](https://developer.android.com/develop/ui/compose/tooling/tracing).
