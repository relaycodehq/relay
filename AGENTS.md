# Working on Relay

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
  (`steps(...)`) instead of animating every frame. Give each loop a
  `prefers-reduced-motion` fallback.
