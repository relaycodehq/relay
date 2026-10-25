# Working on Relay

## Relay runs on macOS, Windows and Linux

- **Don't write "Mac" into the product.** Say "this computer", "here", or
  name the thing ("Not cloned here"), not "this Mac". The file browser's name
  comes from `fileManager`/`revealLabel` in `src/lib/mod-key.ts` (Finder,
  Explorer or file manager), and shortcuts go through `keys()`, never a bare ⌘.
- **The computer a thread is handed off to is any paired Relay**, a desktop,
  a laptop or a headless server, not "the Mac mini". The release Mac mini is
  our build machine, nothing users have.
- Mac-only wording is fine only behind a platform check (the Keychain prompt,
  macOS font smoothing, `relay .` opening the desktop app).

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
  `tests/fixtures` and the build entry points in `scripts/build-electron.mjs`
  where they are.
- **The headless Relay runs the main process's services under plain Node.**
  `electron/headless/` builds them with `electron-stand-in.ts` in place of
  Electron. A new Electron call in something a phone or a handoff reaches
  needs an answer there; `npm run build:headless` fails on a missing export.
- **Check types with `npm run typecheck`.** The renderer, the main process,
  the preload script and the tests are separate projects, so `src/` can't
  reach for Node and `electron/` can't reach for the DOM. A bare
  `tsc --noEmit` checks nothing and passes.
- **One job per file, class and function.** A file past ~500 lines, or a
  function past ~80, does several things: split it by what each part does
  (`lead-messages.ts` came out of `started-threads/index.ts` that way), not
  into arbitrary halves. Files already over 500 are listed with a ceiling in
  `tests/unit/big-files.ts`; they may shrink, never grow. Lower the ceiling
  when you shrink one, and never raise it to fit a change.
- `tests/unit/layout.test.ts` fails when one of these rules is broken, when a
  file grows past its line limit, or when features, or the folders of
  `electron/`, import each other in a circle.

## Readable code

Code should read like you'd explain it out loud: one fact per line, in the
order things happen. A few more words are fine when each one helps; this is
not a call for interfaces and factories.

- **A name says only what the code has checked.** What `chats.get(id)`
  returns is a `thread`; it becomes a parent's child only once you've found
  its `startedBy`.
- **Name the decision.** A run of conditions becomes a predicate with one
  named boolean per rule, and the caller reads as steps:
  ```ts
  // Not this:
  if (!chat?.startedBy || chat.reviewer) return;
  if (!answeredLead(chat, chat.startedBy.chatId)) return;
  if (this.reads.waitsFor(chat.startedBy.chatId, chat.id)) return;
  // This:
  const thread = await this.chats.get(turn.threadId).catch(() => undefined);
  const parentId = thread?.startedBy?.chatId;
  if (!thread || !parentId) return; // no thread to report to
  if (!this.parentShouldHear(thread, parentId, turn)) return;
  ```
- **A name says what the value is, not the question that made it.** `cold`
  sounds like a yes or no, so a `{ provider, tokens }` behind it surprises;
  `compactOffer` doesn't.
- **A function's name answers what you'd ask where it's called.**
  `worthCompactingCold(usage)`, `refusalFor(request)`, `nextMoveIsSet(answer)`;
  not `compactsCold`, `checkStart` or `allows`.
- **`undefined` doesn't mean anything but "not there".** If "no other
  project" means "the lead's own", say so with a type:
  `{ own: true } | { own: false; project }`, then `if (destination.own)`.
- **No double negations.** `!(!chat.queuePaused && …)` becomes a named
  `queuedMessageNext`.
- **A ternary picks between two values; nothing more.** Fine for a string, a
  prop or an argument: `spec.readOnly ? "read-only" : last.runtimeMode`. Three
  or more outcomes become a small function with early returns, or a lookup;
  never a nested ternary. Don't use one in place of `&&`
  (`root?.side ? false : running` is `!root?.side && running`). In JSX, a
  two-way ternary is fine; a chain over which screen is open becomes one value
  and a `switch` or a component per screen.
- **Comments say why, plainly.** "No thread to report to", not "A stop is
  whoever stopped it's to tell". Many older comments are compressed like that;
  don't copy their voice into new code.
- **One word per idea.** Not `lead`, `caller` and `from` for the same thread,
  nor `branch` for a reply thread in an app about Git branches (`replyTo`).
- **Tidy what you touch.** When you change a function, leave it reading like
  this; don't sweep files you aren't working in.

## Deprecated APIs

- **Keep the checks footer at 0 suggestions.** It counts TypeScript's
  suggestion diagnostics, and deprecated calls are nearly all of them. The
  ones that kept coming back:
  - Zod 4: `z.number()` already rejects Infinity, so no `.finite()`; write
    `z.uuid()` and `z.url()`, not `z.string().uuid()`/`.url()`; `.loose()`,
    not `.passthrough()`.
  - TanStack Query: `qc.query(options)` instead of `fetchQuery`, and
    `qc.query(options).catch(() => {})` instead of `prefetchQuery`. Unlike
    `fetchQuery`, `query` applies `select`.
  - IME: `e.nativeEvent.isComposing` alone; no `keyCode === 229`. The
    renderer only runs in Chromium, where that flag is set.
  - `beforeunload`: `event.preventDefault()` alone, no `returnValue`
    (`tests/e2e/quit.spec.ts` covers it).

## Integration sign-in recovery

- **A rejected cached credential must be discarded by its owner.** Wire that
  into the shared request path, so connection checks and feature requests both
  recover. Pass the credential and its rejection handler together, or require
  the handler when constructing a cached client. Keep saved PATs and API keys.
- **Discard only the credential that was rejected.** A late response from an
  old token, account or organization mustn't clear a newer login or its cached
  data. Network errors, permission failures, rate limits and server errors must
  not be treated as sign-outs; classify the provider's documented auth failures.
- **Test recovery through the service callers.** Cover cached sign-in → auth
  refusal → changed CLI login/credential → successful next operation without a
  restart, plus late refusals, settings changes and non-auth failures. Assert
  which credential was sent and how often the credential source was called.
- **Give users a way to recheck after signing in externally.** Verify that UI
  flow when it changes; Relay disables refetching on window focus. Any automatic
  retry must be bounded and provider-aware. Retry a write only when the provider
  guarantees the first attempt wasn't applied; never after an ambiguous failure.

## Showing options

- **Show visual choices as working UI in the browser.** When asked for ideas
  or options to choose from and they can be seen (layouts, cards, flows,
  styles), build them instead of describing them or drawing ASCII. Put the
  page in `previews/<name>/index.html` and `<name>.tsx`; the dev server serves
  it at `http://127.0.0.1:5177/previews/<name>/` (keep the trailing slash:
  without it Vite serves the main app). Previews stay local: git ignores
  everything in `previews/` except `website/`, `promo/` and `_shared/`, so
  don't force-add one. Use the app's own CSS, theme and
  components on sample data (`previews/_shared/desktop-stub.ts` stands in for
  the desktop bridge), add a switcher between the options, make the controls
  work, label the data as sample, check it in a headless browser, then open
  it for the user in Relay's preview pane (the `open_preview` tool) when you
  run inside Relay, otherwise with `open <url>`.
- **Small choices go in the answer instead.** A component, a card, a chart or
  a few variants of one that fit the chat column go through Relay's
  `show_html` tool (with `variants`, checked with `preview_html` first) when
  you run inside Relay. A whole screen, or anything that needs the app's own
  components and stub, still gets a `previews/<name>/` page.
- **A page shown in an answer is self-contained** (`shared/html-render.ts`):
  it can't reach the app's CSS or Relay, only the theme variables the
  frame passes in and public https assets.

## Animations

- **Pause every endless loop while the window is unfocused.** `src/lib/window-focus.ts`
  sets `data-inactive` on the root, and the `:root[data-inactive]` rule in
  `src/styles.css` pauses the loops listed there. Add any new `infinite`
  animation (spinner, shimmer, glyph) to that list. A visible window behind the
  editor still repaints every display refresh; one spinner measured ~18% of a
  core, paused ~0%. The exceptions: the sidebar's spinners on running
  threads keep turning (their arc still pauses), so a glance at the window
  says which threads are busy, and so does the unread-steer spinner on a
  sent message, which frozen looks stuck. Don't add others to it.
- **Animate one thing at a time in an agent turn.** Either the running call's
  row or the thinking line, never both. Headers and finished rows stay still.
- **Keep live rows from jumping.** Rows that come and go with each tool call
  should reserve their height instead of mounting and unmounting; the thread
  stays pinned to the bottom, so every height change jolts it.
- **Don't move the thread under the reader.** Something at the end of the
  thread that changes height (the composer folding, a card above it) keeps
  the room it takes until it has settled; never size the view from an element
  mid-transition, whose first measurement is where it started. After touching
  `useThreadScroll`, the composer dock or the end of the thread, run
  `tests/e2e/thread-scroll.spec.ts`: the release CI runs only unit tests.
- **Keep it cheap.** Move things with `transform`/`opacity`, and step every
  endless loop at 20 updates a second (`steps(seconds × 20)`; for an eased
  loop, sample the curve into a few keyframes, each with its own `steps`).
  A smooth loop asks for a frame every display refresh even on the
  compositor: with 5 threads running, the smooth `.live-shine` alone cost
  ~17% of a core, stepped ~2%.
- **Reduced motion is global.** `src/styles.css` stops every animation and
  transition under `prefers-reduced-motion`, except the loops that show
  something is working (spinners, the live shimmer, the thinking glyph): a
  new one of those goes on that list too. Add a local block only to fix the
  end state a stopped animation leaves wrong (a half-drawn stroke, a sheen still
  showing) or to beat another stylesheet's `!important`.

## The phone apps

- **Working in `ios/`? Read `ios/AGENTS.md` first**, and `android/AGENTS.md`
  for `android/`. They hold how to build, run and check each app quickly;
  for the iPhone that's `ios/scripts/sim.sh`, hot reload, and the habits that
  keep a layout tweak from taking a dozen 60s builds.

## Commit messages

- **Use Conventional Commits**: `type(scope): subject`, the scope optional.
  Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `style`, `build`,
  `ci`, `chore`, `revert`. Scope is the area, short: `android`, `ios`,
  `phone`, `terminal`, `worktrees`, `deep-review`, `headless`, `website`.
  - `fix(terminal): resize from the visible height`
  - `feat(sidebar): show thread branches and merge status`
  - `chore: bump version to 0.18.2`
- **The subject is one lowercase imperative line, under ~72 characters, no
  trailing period.** No colon-separated tour of every behaviour, no
  "X, Y, and Z" lists. The why and the non-obvious details go in the body,
  wrapped, only when they're needed. A breaking change gets `!` after the
  type and a `BREAKING CHANGE:` footer.
- **Don't copy the style of older commits in the log.** Before 2026-10-20
  subjects were plain sentences, and from 2026-10-09 they drifted into
  changelog paragraphs; neither is the style. Release notes are written
  separately by the `release` skill.

## Releases

- **Pushing to main ships nothing; a `v*` tag does.** The Mac mini builds
  annotated tags on main, and the tag's message is the changelog friends see
  in Settings → About. The `release` skill drafts the notes and tags.
