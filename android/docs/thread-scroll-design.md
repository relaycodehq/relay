# Thread scroll ownership and geometry

The Android app was already native Compose. The October 15 scroll change made
its list oldest-first; the October 22 Fold investigation then fixed independent
measurement and layout bugs. This rewrite replaces the scroll coordination and
message row boundaries. It keeps the verified TextView, zero-width WebView and
inline-image measurement fixes.

The design was reviewed in two rounds with Opus 5.5 High. The important decision
was to keep Compose's keyed LazyColumn anchoring and replace competing scroll
requests with explicit intent, rather than implement another scrolling engine.

## Ownership

`ScrollPolicy` is pure Kotlin. `ThreadScroll` interprets its effects; no message,
composer, diagnostics callback or independent coroutine may request bottom-follow.
`ThreadViewport` is used by the screen, gallery and instrumentation fixtures.

- Following can request the end only without a pointer, scroll or navigation.
- Reading retains LazyColumn's key and offset; idle geometry never re-pins it.
- Navigation takes ownership before starting an animation. Pointer or reader
  input cancels its child job. Content changes cannot interrupt it.
- Restoration holds a saved key until rows arrive, then applies it once. A
  missing source line prefers the same message; an unavailable message falls
  back to the saved list index once the initial load completes.
- User scroll intent is observed synchronously by nested scroll, including a
  gesture too short for snapshotFlow to observe its scrolling phase.
- Holding a pointer pauses following. If the end is below the viewport on
  release, reading wins. There is no duration threshold; a tap without growth
  keeps following. Accessibility and other unowned scrolls use the same policy.

Input observation consumes no gestures and works with logging disabled.
Diagnostics record transitions, requests, native events and layout snapshots;
they do not participate in decisions.

## Measurement

A composition content signature schedules following before the next layout.
Viewport dimensions are observed in the parent's measure before its LazyColumn
child measures. Requests are gated on changed dimensions, not every measure:
an unconditional request here creates a layout loop. Async child size changes
have one post-layout correction through the same policy, only while following.

Every assistant answer has stable header, render, Markdown block and footer
rows, including before its first render arrives. Markdown keys use normalized
source start lines; appending text changes the tail, not earlier paragraph keys.
Reference definitions reparse the message because they can affect earlier text.
Parsing caches are retained per loaded message and pruned with the loaded set.

Header/footer/end chrome retain shrinking geometry while reading or holding a
pointer. Body edits use natural layout. A reading viewport can shrink, but grows
only when enough content exists below its anchor to avoid clamping. Its reserve
never exceeds the available window and resets on width changes or following.
There is always a separate tiny bottom sentinel, after queue content; following
its top remains correct even when the queue is taller than the viewport.

HTML and math settled-size hints use bounded LRU caches, including actual width,
font scale and theme. Hints never crop content. Inline images retain their frame
through fetching, decoding, failure and streaming completion. Native selectable
TextViews are not pooled: repeated visits must measure unchanged text identically.

Loading earlier history saves the first visible message row rather than the
persistent history button, and waits for changed keys before restoring it.
Saved state uses a row key plus offset, rather than relying on a numeric index.
Width/font changes preserve the block key with a proportional offset after
remeasurement; this is best effort, not glyph-exact across changed line wrapping.

## Limits and regression requirements

No test suite proves that every future device/WebView version has no bugs.
Tests enforce concrete invariants and run without pairing or a physical phone;
see [scroll-testing.md](scroll-testing.md).

Intentional expansion, edits within a visible paragraph, and width/font changes
can reflow that content. A first-time HTML/math estimate can also settle to a
different height while that row is visible. The rewrite isolates those changes
from independently anchored paragraphs; it does not clip content or disguise
reflow as a successful no-movement check. Nested lists/quotes/tables remain
atomic Markdown blocks, so internal edits can still reflow those blocks.

Future dynamic elements must have stable row identity and either predictable
geometry or their own independently anchored row. Add a regression that changes
them while reading, holding a pointer, following and navigating. Keep the tests
against the production viewport and native renderers, not a second list with
similar-looking test-only scroll logic.
