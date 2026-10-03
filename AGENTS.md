# Working on Relay

## Where code goes

- **Group by feature, not by kind.** A feature's components, hooks, CSS and
  helpers live together in `src/features/<name>/`, and its unit test sits next
  to the file it covers as `<file>.test.ts`. There is no `components/` or
  `hooks/` folder; don't bring one back.
- **`src/app/` is the shell** (titlebar, navigation, what is on screen),
  **`src/ui/` is building blocks that know no feature**, **`src/lib/` is
  helpers that know no feature.** `lib/` and `ui/` never import from
  `features/` or `app/`, and features never import from `app/`. A hook only
  one feature uses belongs in that feature, not in `lib/`.
- **Nothing loose in `electron/`.** Only `main.ts` and `preload.ts` sit at the
  top; everything else goes in the folder of what it is about (`git/`,
  `project-chats/`, `agents/`, `platform/`, `util/` and so on). A folder's
  public face is its `index.ts`.
- **`shared/` is what the desktop, the phone and the server all read.** It
  imports nothing from `src/`, `electron/` or `server/` and uses neither DOM
  nor Node globals.
- **Start a new folder when a feature has about four files of its own**;
  until then it lives in the feature it grew out of.
- **Move files with `node scripts/move-files.mjs <mapping.json> --dry`**, which
  rewrites imports, mocks, worker URLs, CSS and HTML references. Leave
  `tests/fixtures`, the `vendor/` folders and the build entry points in
  `scripts/build-electron.mjs` where they are.
- **Check types with `npm run typecheck`.** The renderer, the main process,
  the preload script and the tests are separate projects, so `src/` can't
  reach for Node and `electron/` can't reach for the DOM. A bare
  `tsc --noEmit` checks nothing and passes.
- `tests/unit/layout.test.ts` fails when one of these rules is broken, or when
  features, or the folders of `electron/`, import each other in a circle (the
  known `electron/` ones are listed there; delete an entry when you break one).

## Showing options

- **Show visual choices as working UI in the browser.** When asked for ideas
  or options to choose from and they can be seen (layouts, cards, flows,
  styles), build them instead of describing them or drawing ASCII. Put the
  page in `previews/<name>/index.html` and `<name>.tsx`; the dev server serves
  it at `http://127.0.0.1:5177/previews/<name>/` (keep the trailing slash:
  without it Vite serves the main app). Use the app's own CSS, theme and
  components on sample data (`previews/_shared/desktop-stub.ts` stands in for
  the desktop bridge), add a switcher between the options, make the controls
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

## Releases

- **Pushing to main ships nothing; a `v*` tag does.** The Mac mini builds
  annotated tags on main, and the tag's message is the changelog friends see
  in Settings → About. The `release` skill drafts the notes and tags.
