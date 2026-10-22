# Android scroll diagnostics

Recording starts when a thread or the diagnostics settings are opened. It runs
locally in release builds too. It contains IDs, counts and geometry, never
message bodies, rendered HTML, URLs, drafts or credentials.

After a jump, open the thread's **… → Keep scroll incident**. This preserves up
to 2 MiB of recent history in a marked slot. The last three marked incidents
survive restarts and ordinary log rotation. Automatic detection has two
separate slots, so repeated detections cannot evict marked incidents.

Use **Settings → Developer → Save scroll logs**, then choose a destination in
the phone's file picker. The ZIP is captured before opening the picker. Saving
or cancelling does not clear history; a saved ZIP is independent of recording.
When saved to Downloads, it can also be pulled with `adb pull`.

Storage has no time-based expiry: eight rolling 1 MiB segments, three marked
2 MiB incidents, and two automatic 2 MiB incidents, at most **18 MiB** total.
There is also one replaceable export ZIP in cache. UI events enter a bounded
512-command queue; disk writes and exports use one IO worker. Queue overflow
and write failures are counted in `droppedBefore`, rather than blocking the UI.

The export's README explains the schema. Useful events:

- `thread_state`, `row_order`, `message_metadata`: loaded full-thread membership,
  message status/version/content lengths, rendered-card IDs, and last measured
  dimensions. `earlier` counts history not fetched from the computer.
- `row_size`: measured message section, rendered card, earlier-history row and
  end-row height changes. Assistant messages always have separate stable
  header, card, source-line keyed Markdown block and footer keys, so a card
  settling above the reader does not move the answer paragraph's anchor. `message_metadata.rowKeys` maps these parts back
  to their message; its total measured height is known only once every part has
  been measured.
  Offscreen lazy rows that have never been composed have unknown heights. The
  recorder never forces the whole thread to render for a total-height estimate.
- `layout`: first visible row and offset, viewport bounds and dimensions,
  visible row keys/positions/sizes, scrollability, pinning, common-anchor shift,
  and the most recent app scroll request. At most ten snapshots per second,
  emitted only on change. The final settled position is included.
- `scroll_request`, `scroll_phase`, `pin`: content changes, viewport changes, asynchronous layout changes,
  sending, keyed restoration, note navigation and bottom-pinning decisions.
  These requests come from one scroll policy; diagnostics never decide intent.
- `geometry`, `configuration`, `ime`, `composer_focus`, `touch`: window/list/
  composer dimensions, density/font scale, keyboard inset, focus, and observed
  pointer activity. Touch recording never consumes input.
- `html_mount`, `html_size`, `html_frame`, `html_touch`, `html_focus`,
  `html_rectangle_request`, `html_native_scroll`: embedded WebView lifecycle,
  raw/clamped CSS measurements, fitting scale, native sizes, focus requests and
  inner scrolling. Frame pixels and CSS/dp units are explicitly named.
- `text_size`: native paragraph character counts and measured pixel dimensions,
  scoped to their message. Compare these and the layout row sizes across repeated
  visits to unchanged messages to find stale text measurements after recycling.

`suspected_jump` is a heuristic: a large idle anchor movement (or replacement
of every visible row), without a recent gesture or app scroll request. It saves
context one second later, at most once per 30 seconds. It does not claim to
detect every jump. Marking an incident manually also captures jumps caused by
the app's own requests. `cause=unattributed` is intentionally inconclusive;
inspect surrounding size, keyboard, focus and request events.

Wall time, monotonic uptime, process ID, screen session and event sequence help
correlate recordings. The export records app, Android and WebView versions.
Repeated message manifests once per minute keep context available after
rotation; intermediate updates are sampled at most four times per second.

## Repeatable scroll checks

Settings → Developer → Component gallery → Scroll checks uses sample data and
the real thread scroll controller, native markdown, image frame and dock. It
does not send messages or change a real thread. Its events use thread ID
`scroll-regression-sample` in the same diagnostic export.

- At the bottom, use **Up 6 px**, then **Stream**. Pinning must stay false and
  the first visible row's offset must stay unchanged as text grows below it.
- While six pixels from the end, use **Toggle status** and **Toggle draft**.
  The viewport retains only the space needed to prevent clamping the reader
  back to the bottom; the dock renders at its real size. **Bottom** releases the reserved space.
- Scroll to the sample image and text below it. **Load image** and **Fail image**
  must keep the image row's height and the visible text's offset unchanged.
  Real inline images use the same reserved frame, with `ContentScale.Fit`;
  loading, failure and streaming → saved do not change its dimensions.
- Scroll to the sample turn, then use **Finish tools**. A trace held open for
  reading keeps the thinking row's space when its turn finishes.
- From the bottom, start **Stream** and hold a finger on the list. No app
  follow request may happen while held. If text grew, releasing the finger
  leaves pinning off instead of snapping down through the accumulated text.

Bottom pinning permits only one physical pixel of rounding. HTML height
estimates and cached sizes use the card's actual available width, including
when the phone uses a narrow pane on a wide screen.

### Fold validation, 2026-10-22

`0.19.4-scroll-logs.6` was checked on a Galaxy Z Fold7 with 20 settled and four
current threads: five upward and five downward swipes per thread, mixing slow
drags and flings, with idle periods and screenshots. Across 1,765 layout samples
there were no unexplained consecutive idle anchor shifts, follow requests while
touching or unpinned, or changing heights of unchanged native rows. No diagnostic
events were dropped. HTML estimate widths matched WebView measurement widths.

The gallery transitions above also held the visible text's coordinates: the
sample image stayed 1,016 px high through load/failure, and the held tool row
stayed 246 px high through completion. Releasing a finger after streamed growth
left pinning off. The release build and 333 JVM tests passed.

This was a scroll sample across 24 conversations; it did not traverse every
message or fetch every older-history page of the longest conversations.

## Rewrite regression gate

The Fold sweep above describes the preserved baseline, not a physical-device
validation of the rewrite. See [scroll-testing.md](scroll-testing.md) for the
emulator regression command and [thread-scroll-design.md](thread-scroll-design.md)
for ownership, restoration and layout contracts. The real screen, gallery and
instrumentation fixture share `ThreadViewport`.
