# Working on Relay

## Showing options

- **Show visual choices as working UI in the browser.** When asked for ideas
  or options to choose from and they can be seen (layouts, cards, flows,
  styles), build them instead of describing them or drawing ASCII. Put the
  page in `previews/<name>.html` and `.tsx`; the dev server serves it at
  `http://127.0.0.1:5177/previews/<name>.html`. Use the app's own CSS, theme
  and components on sample data (`previews/desktop-stub.ts` stands in for the
  desktop bridge), add a switcher between the options, make the controls
  work, label the data as sample, check it in a headless browser, then open
  it for the user with `open <url>`.

## Animations

- **Pause every endless loop while the window is unfocused.** `src/lib/window-focus.ts`
  sets `data-inactive` on the root, and the `:root[data-inactive]` rule in
  `src/styles.css` pauses the loops listed there. Add any new `infinite`
  animation (spinner, shimmer, glyph) to that list. A visible window behind the
  editor still repaints every display refresh; one spinner measured ~18% of a
  core, paused ~0%.
- **Animate one thing at a time in an agent turn.** Either the running call's
  row or the thinking line, never both. Headers and finished rows stay still.
- **Keep live rows from jumping.** Rows that come and go with each tool call
  should reserve their height instead of mounting and unmounting; the thread
  stays pinned to the bottom, so every height change jolts it.
- **Keep it cheap.** Move things with `transform`/`opacity`; step text shimmers
  (`steps(...)`) instead of animating every frame, unless a shimmer on its own
  layer measures as cheap as paused and steps would read as lag (the agent
  trace's `.live-shine`).
- **Reduced motion is global.** `src/styles.css` stops every animation and
  transition under `prefers-reduced-motion`. Add a local block only to fix the
  end state a stopped animation leaves wrong (a half-drawn stroke, a sheen still
  showing) or to beat another stylesheet's `!important`.
