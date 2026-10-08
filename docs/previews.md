# Browser previews

Open **Browser** from the panel's surface picker. On macOS and Linux, Relay reuses
its running-task scanner to find an HTTP server already running in this thread's
folder, including dev servers left running by an agent or a Relay terminal.
There is no special launch command: start the project's normal dev command.
When several HTTP servers run in the same folder, use an explicit localhost URL
or save the intended dev port instead of letting Relay guess. Windows currently
needs an explicit URL or saved dev port.

Project settings → Preview can also save a **Dev command** and **Dev port**.
When no existing server can be selected, Relay starts that command on demand.
Worktrees add their `RELAY_PORT_OFFSET` to the saved port. Commands receive `PORT`
and the existing worktree environment. Relay sleeps servers it started after
30 idle minutes, and leaves other servers alone.

## Named worktree links

The pane loads localhost directly. Every thread has its own Electron storage
partition, including threads working in the checkout. Existing worktree sessions
are retained; new thread sessions seed their cookies from the checkout on first
open. Agent screenshots,
console tools and element picking use this same browser.

**Open in browser** gives the current page a named external URL, for example
`http://feat-how-it-works-a1b2c3d4.autago.relay.localhost:1377/how-it-works`.
The hostname identifies the folder, independent of its server port. The short
hash prevents equal branch or project names from colliding. Paths, queries and
fragments are kept. Remote sites open at their original URL.

The agent's `open_preview` tool now returns `url` for the direct pane address and
`browserUrl` for the named link to share with the user. The route is live when
the tool returns; the user's browser is not opened automatically. A proxy startup
failure returns `browserUrlError` while the in-app preview remains usable.
Completed agent answers automatically convert clickable localhost links when
the port belongs to a verified HTTP server in the thread's checkout or worktree.
This includes worktrees the agent created itself. The Browser uses the same
folder and server identity; if several of the thread's worktrees have servers,
an explicit localhost URL selects one, and that selection is kept. No Browser pane or preview
tool call is needed. Link paths, queries and fragments survive; inline code and
terminal output keep their direct addresses. Older answers stay as written.
Existing named server links are also included in the agent's context on later
turns. Discovery currently runs on macOS and Linux.

The first named service in a folder keeps the folder's hostname. Additional
ports get a `p-<port>` prefix. Each issued hostname stays bound to its original
port for the Relay session, even when other servers start or the original stops.
Unknown ports and ambiguous process ownership keep their original URLs rather
than pointing to another app.

If the original port stops answering, its named link shows an unavailable page
(HTTP 502). A saved dev command can wake the server on that same port. Moving to
a different port requires a fresh named link; Relay never guesses that a sole
remaining listener is the original service. The route registry resets when
Relay quits.

**All previews in browser** opens `http://relay.localhost:1377/`, listing open
project/worktree previews with their ports and last captured screenshots. It
does not revive hidden browser renderers to take pictures. **Open in its own
window** keeps Relay's existing browser partition and login.

The proxy starts when a named link is produced for an answer, agent context,
button or preview tool,
listens only on `127.0.0.1`, and runs until Relay quits. Closing the main window
keeps external links working while Relay stays in the menubar. Portless URLs
would require port 80; this build deliberately uses the high port 1377.

HTTP requests, POST bodies and WebSockets pass through. Saved dev commands wake
on a request; requests refresh their idle timer. Local redirects stay on the
named host, and cookies are scoped to it. Initial HTML titles get a `[branch]`
prefix (the project name for a checkout). No JavaScript is injected; an SPA may
replace that title later.

## Browser limits

Chromium and Firefox resolve `*.localhost` themselves and treat these addresses
as secure contexts without certificates. Chromium is covered by integration
tests. Safari on macOS needs system resolver setup for these names; this build
does not install a resolver or request admin access. Copy the direct localhost
URL for Safari instead.

External browsers have their own cookie storage, separate from Relay's pane.
Each named worktree host also has its own external session, so opening a named
link may require another login. Apps with hardcoded origins, cookie domains,
WebSocket addresses or OAuth callbacks may need their own configuration.
The upstream Host is localhost, with the external authority in
`X-Forwarded-Host`; JavaScript and CSP are not rewritten.

Phone links/Tailscale listeners remain separate work. The current loopback-only
proxy cannot be reached from a phone. Ports on one IP do not isolate cookies.

The headless Relay has no browser renderer. Browser API calls and preview tools
report that previews are unavailable there; ordinary headless services still run.
