# Browser previews

Open **Browser** from the panel's surface picker. On macOS and Linux, Relay reuses
its running-task scanner to find an HTTP server already running in this thread's
folder, including dev servers left running by an agent or a Relay terminal.
There is no special launch command: start the project's normal dev command.
When several HTTP servers run in the same folder, use an explicit localhost URL
or save the intended dev port instead of letting Relay guess. Windows currently
needs an explicit URL or saved dev port.

Relay remembers each thread's last address, including its path, query and
fragment, and the checkout or worktree it belonged to. Opening Browser after
quitting restores that page. When a launch command is known, Relay starts the
server first and waits for it to listen before loading the page. It does this
when the preview is opened, rather than starting every old preview on launch.

Agents can pass `command` with `open_preview` to save the server's dev command
for that thread. Use a foreground command that listens on the URL's port;
Relay also supplies that port as `PORT`. Relay does not reconstruct commands
from a discovered process's display name. If an old localhost preview has no
known command and its connection is refused, its pane offers **Dev command →
Start preview** to save one and start it. Startup errors show the command's
output and **Try again** retries it.

Project settings → Preview can also save a **Dev command** and **Dev port**.
When no existing server can be selected, Relay starts that command on demand.
Worktrees add their `RELAY_PORT_OFFSET` to the saved port. Commands receive `PORT`
and the existing worktree environment. Relay sleeps a server it started once
nothing has shown or connected to it for 30 minutes, and leaves other servers
alone. A browser tab outside Relay counts while it holds a connection open, as
hot-reload sockets do; a server without one may sleep under an idle tab.

On macOS and Linux the servers Relay starts run in the agent host, so they keep
running while Relay restarts for a rebuild or an update, and the next Relay
takes them back. Quitting Relay stops them, and so does the host once Relay has
been gone 10 minutes with no agent working there. On Windows they still run in
Relay and stop with it.

## Sessions and links

The pane loads localhost directly. Every thread has its own Electron storage
partition, including threads working in the checkout. Existing worktree sessions
are retained; new thread sessions seed their cookies from the checkout on first
open. Agent screenshots, console tools and element picking use this same
browser.

**Open in browser** opens the page's own address, `http://localhost:<port>/…`,
in the default browser. Each worktree is told apart by its port, so links in
answers stay as the agent wrote them. **Open in its own window** keeps Relay's
browser partition and login.

## Browser limits

External browsers have their own cookie storage, separate from Relay's pane.
Cookies ignore ports, so the checkout and a worktree on another port share one
cookie jar there: an app whose session cookie has a fixed name logs one out when
you log into the other. Use the pane for side-by-side sessions, or give the
cookie a name that includes `RELAY_PORT_OFFSET`.

The headless Relay has no browser renderer. Browser API calls and preview tools
report that previews are unavailable there; ordinary headless services still run.
