# Android scroll regression tests

Run from the repository root:

```sh
android/scripts/test-scroll.sh
```

This builds the debug app and instrumented test APK, selects an Android emulator,
installs both APKs explicitly on that emulator, and runs the local thread tests.
It never installs on a USB phone, pairs with Relay, opens real threads, or writes
remote messages. Existing emulators are left running. If none is running, the
script starts the `relay-phone-16` AVD and shuts down only that instance on exit.
Set `RELAY_TEST_EMULATOR=emulator-5554` to choose an existing emulator, or
`RELAY_TEST_AVD=other-avd-name` to choose an installed AVD.

## One-time setup

Install Android SDK command-line tools, platform-tools, emulator, JDK21, the
project's compile SDK, and an API36 Google APIs system image matching the host
architecture. For Apple Silicon:

```sh
sdkmanager 'platform-tools' 'emulator' 'platforms;android-37' 'system-images;android-36;google_apis;arm64-v8a'
echo no | avdmanager create avd -n relay-phone-16 -k 'system-images;android-36;google_apis;arm64-v8a'
```

For an x86 Linux runner use `x86_64` instead of `arm64-v8a`. Hardware acceleration
is required for useful test turnaround. `ANDROID_HOME` and `JAVA_HOME` override
the defaults in the script.

## What the suite exercises

The fixture uses the same `ThreadViewport` and scroll controller as a real
conversation, with real native Markdown and inline image frames. Sample rows
and deterministic state changes replace the server. Tests freeze Compose's
clock, advance individual frames, and compare keyed visible offsets. A following
reader must reach the exact end within one physical pixel; a reader looking back
must retain the same keyed row and offset. The measurement-order spike checks
that a viewport shrink can follow in the parent's first layout pass.

The suite covers tail growth in both modes, tiny reader intent during growth,
pointer holds versus taps, viewport/dock changes near the end, prepended history,
finishing content, image loading/failure, and repeated native text remeasurement.
These are behavioral assertions rather than screenshot comparisons. They catch
single-pixel movement even if an animation makes it hard to notice manually.

JVM policy and geometry tests still run separately:

```sh
cd android
./gradlew :app:testDebugUnitTest
```

The emulator cannot prove vendor-specific behavior, fold transitions, or every
WebView release. Keep occasional physical-device smoke testing for those;
ordinary scroll regressions no longer require a phone connected by USB.

## Regression gate and limits

Nothing runs it automatically; Relay doesn't use GitHub Actions. Run it before
landing scroll changes. It includes the JVM suite and captures instrumentation
output in `android/app/build/scroll-test-results.txt`. It has been exercised on
the API36 ARM64 emulator.

Additional device cases exercise production message block keys, inserting and
removing render rows above a paragraph, the persistent earlier-history button
while new paragraphs stream, a queue taller than the viewport, notes navigation
during streaming, saved state restoration, width/font scale changes, semantic
scroll/index actions, fling/cancel, local KaTeX cache revisits, and the real
WebView size bridge with raw Android pointer events held over the WebView.

The invariant for unchanged content and layout width is an unchanged keyed row
and physical-pixel offset while reading. A width or font-size change necessarily
reflows text: preserve the source block and proportional position, rather than
claiming that the same physical pixels can remain visible. Deliberate navigation,
a deleted anchor, or content edits inside the anchored block can also change what
fits. These cases must have an explicit policy; silently enabling bottom-follow
because geometry happened to reach the end is never a substitute.

When changing the controller, row keys, loading frames, native Markdown, WebView
sizing, or dock layout, run the gate. Keep a failing case as a regression before
fixing its shared cause. Do not weaken pixel assertions or replace real native
renderers with fixed-height mocks to make a timing failure disappear.

## Failed history requests and layout cost

History recovery tests assert both mode and pixel positions: failure leaves
`Reading` with every visible coordinate unchanged; a retry ignores the previous
failure and restores the same paragraph when history arrives. Explicit bottom
navigation after failure remains usable. JVM tests exercise the actual model's
failed/empty responses, retry amount, queued fetches, maximum page and automatic
reconnect behavior through an injected fetch function, without a live bridge.

`ThreadLayoutCostTest` also scrolls the production viewport over 80 separate
frames and counts parent measurements, viewport-call-site recompositions, newly
measured lazy rows and dock measurements. On the API36 ARM64 emulator, the
unconditional layout-state read produced 81 extra parent measures; lazy geometry
observation reduced that to 0, with 24 incoming rows measured in both runs and no
call-site recompositions or dock remeasurements. This is a structural cost check,
not a claim about release frame timing on physical devices. A parent dependency
while reclaiming reserved space is intentional and covered separately.
