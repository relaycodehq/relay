/**
 * The guest page's code. Message bodies arrive as HTML the server built with
 * everything escaped; anything else from the thread is set as text. No
 * backticks or `${` in here: it's one String.raw template.
 */
export const GUEST_SCRIPT = String.raw`(() => {
  const data = JSON.parse(document.getElementById("relay-guest-data").textContent);
  const base = location.pathname.replace(/\/+$/, "");
  // Renders load from their own address under the site, never under the link's token.
  const site = base.replace(/\/g\/[^/]+$/, "");
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const CHEVRON = "M9 6l6 6-6 6";
  const icon = (path, cls) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (cls) svg.setAttribute("class", cls);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", path);
    svg.append(line);
    return svg;
  };
  // A browser blocking storage throws on reading it; the page then just doesn't remember.
  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const store = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  const guestId = stored("relay-guest-id") || (() => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    store("relay-guest-id", id);
    return id;
  })();
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = "#theme=" + encodeURIComponent(JSON.stringify(dark ? data.themes.dark : data.themes.light));
  const statusLabel = { waiting: "Waiting for the host", sent: "Sent by the host", drafted: "Picked up by the host", dismissed: "Not used" };
  const kindLabel = { command: "run", file: "edit", read: "read", search: "search", web: "web", agent: "agent", tool: "tool" };
  const sizeLabel = (n) => {
    if (n < 1024) return n + " B";
    if (n < 1048576) return Math.round(n / 1024) + " KB";
    return (n / 1048576).toFixed(1) + " MB";
  };

  let view = data.view;
  const messages = new Map(view.messages.map((m) => [m.id, m]));
  const nodes = new Map();
  let ended = false;
  /** Counts files opened, so a slow earlier one can't fill the viewer under a later one's name. */
  let fileOpened = 0;

  $("name").value = stored("relay-guest-name") || "";
  $("continue").href = "relay://guest?link=" + encodeURIComponent(location.origin + base);

  function hydrate(root) {
    for (const media of root.querySelectorAll("[data-media]")) media.src = base + "/media/" + media.dataset.media;
    for (const link of root.querySelectorAll("[data-file]"))
      link.addEventListener("click", (e) => { e.preventDefault(); openFile(link.dataset.file); });
  }

  async function showDetail(row, m, a) {
    const pre = el("pre", "", "Loading…");
    row.append(pre);
    const res = await fetch(base + "/detail/" + m.id + "/" + encodeURIComponent(a.id));
    pre.textContent = res.ok ? await res.text() : "Not available.";
  }

  // Refilled in place, so the list stays open and so does any output being read.
  function fillCalls(box, m) {
    const activities = m.activities || [];
    box.hidden = !activities.length;
    const reading = new Set(Array.from(box.querySelectorAll(".call"), (row) => row.querySelector("pre") ? row.dataset.id : null));
    const summary = el("summary");
    summary.append(icon(CHEVRON, "chevron"), el("span", "", activities.length + (activities.length === 1 ? " tool call" : " tool calls")));
    const rows = el("div", "calls");
    box.replaceChildren(summary, rows);
    for (const a of activities) {
      const row = el("div", "call " + a.status);
      row.dataset.id = a.id;
      const line = el("div", "call-line" + (a.detail ? " open" : ""));
      line.append(el("span", "kind", kindLabel[a.kind] || a.kind), el("span", "label", a.label));
      row.append(line);
      if (a.detail) {
        line.addEventListener("click", () => {
          const open = row.querySelector("pre");
          if (open) return open.remove();
          showDetail(row, m, a);
        });
        if (reading.has(a.id)) showDetail(row, m, a);
      }
      rows.append(row);
    }
  }

  // New pages are added after the ones showing; moving a frame would reload it.
  function fillRenders(box, renders) {
    const showing = Array.from(box.children, (child) => child.dataset.id);
    const added = renders.slice(showing.length);
    if (showing.some((id, i) => !renders[i] || renders[i].id !== id)) return box.replaceChildren(...renders.map(renderFrame));
    box.append(...added.map(renderFrame));
  }

  // Pictures sent with a message are thumbnails, as in Relay; a click shows one whole.
  function fillShots(box, m) {
    const ids = (m.images || []).concat(m.preview ? [m.preview] : []);
    box.hidden = !ids.length;
    box.replaceChildren(...ids.map((id) => {
      const button = el("button", "message-image");
      button.type = "button";
      button.title = id === m.preview ? "Browser preview" : "Open picture";
      const img = el("img");
      img.dataset.media = id;
      img.alt = id === m.preview ? "Browser preview" : "";
      button.append(img);
      return button;
    }));
    hydrate(box);
  }

  function showPicture(src) {
    $("lightbox-image").src = src;
    $("lightbox").showModal();
  }

  function renderFrame(r) {
    const box = el("div", "render");
    box.dataset.id = r.id;
    const head = el("div", "render-head");
    head.append(el("span", "", r.title));
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.loading = "lazy";
    const show = (i) => {
      const heights = r.pages[i].heights;
      if (heights && heights.length) frame.style.height = Math.min(2000, Math.max(80, heights[Math.min(heights.length - 1, 3)])) + "px";
      frame.src = site + "/r/" + r.key + "/" + i + theme;
      head.querySelectorAll("button").forEach((b, j) => b.classList.toggle("on", j === i));
    };
    if (r.pages.length > 1) r.pages.forEach((p, i) => {
      const b = el("button", "", p.label || "Option " + (i + 1));
      b.type = "button";
      b.addEventListener("click", () => show(i));
      head.append(b);
    });
    box.append(head, frame);
    show(0);
    return box;
  }

  addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    const frame = Array.from(document.querySelectorAll(".render iframe")).find((f) => f.contentWindow === e.source);
    if (!frame) return;
    if (msg.relayRender === "size" && typeof msg.height === "number") frame.style.height = Math.min(2000, Math.max(80, msg.height)) + "px";
    if (msg.relayRender === "link" && /^https?:/i.test(msg.href)) window.open(msg.href, "_blank", "noopener,noreferrer");
  });

  // Laid out as Relay's thread is: what the user sent sits in a box under its
  // pictures; an answer folds its tool calls above its text.
  function messageNode(m) {
    const li = el("li");
    const head = el("header");
    const name = el("strong");
    const mark = m.provider && data.marks[m.provider];
    if (mark) { const glyph = el("span", "glyph"); glyph.innerHTML = mark; name.append(glyph); }
    name.append(document.createTextNode(m.from));
    head.append(name);
    if (m.created) head.append(el("time", "", new Date(m.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
    const body = el("div", "body");
    body.append(el("div", "markdown"));
    const shots = el("div", "message-images");
    if (m.role === "user") li.append(head, shots, body);
    else li.append(head, el("details", "agent-activity"), el("div", "renders"), body, shots);
    updateMessage(li, m, undefined);
    return li;
  }

  // Only the parts that changed are rebuilt: a streaming answer leaves its pages and open lists be.
  function updateMessage(li, m, before) {
    const same = (key) => before && JSON.stringify(before[key]) === JSON.stringify(m[key]);
    const part = (cls) => li.querySelector(":scope > ." + cls);
    li.className = "message " + m.role + (m.streaming ? " streaming" : "");
    const calls = part("agent-activity");
    if (calls && !same("activities")) fillCalls(calls, m);
    const renders = part("renders");
    if (renders && !same("renders")) fillRenders(renders, m.renders || []);
    if (!before || before.html !== m.html) { const body = li.querySelector(".markdown"); body.innerHTML = m.html; hydrate(body); }
    if (!same("images") || !same("preview")) fillShots(part("message-images"), m);
  }

  function renderMessages(changed, before) {
    const atEnd = innerHeight + scrollY >= document.body.scrollHeight - 120;
    for (const m of changed) {
      const old = nodes.get(m.id);
      if (old) updateMessage(old, m, before && before.get(m.id));
      else nodes.set(m.id, messageNode(m));
    }
    const list = $("messages");
    const order = view.messages.map((m) => m.id);
    for (const [id, node] of nodes) if (!order.includes(id)) { node.remove(); nodes.delete(id); }
    order.forEach((id, i) => { const node = nodes.get(id); if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null); });
    if (atEnd) scrollTo(0, document.body.scrollHeight);
  }

  function renderFiles() {
    $("files").hidden = !view.files.length;
    $("file-list").replaceChildren(...view.files.map((f) => {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.append(el("span", "", f.path), el("span", "", (f.changed ? "changed · " : "read · ") + sizeLabel(f.bytes)));
      b.addEventListener("click", () => openFile(f.id));
      li.append(b);
      return li;
    }));
  }

  function renderSuggestions(list) {
    $("yours").hidden = !list.length;
    $("suggestions").replaceChildren(...list.map((s) => {
      const li = el("li");
      li.append(el("span", "", s.text), el("span", "", statusLabel[s.status] || s.status));
      return li;
    }));
  }

  function renderHead() {
    document.title = view.title + " · Relay";
    $("title").textContent = view.title;
    $("working").hidden = !view.running;
  }

  async function openFile(id) {
    const file = view.files.find((f) => f.id === id);
    if (!file) return;
    const dialog = $("viewer");
    $("viewer-path").textContent = file.path;
    const list = el("ol");
    $("viewer-body").replaceChildren(el("p", "", "Loading…"));
    dialog.showModal();
    const opened = ++fileOpened;
    const res = await fetch(base + "/file/" + id);
    const text = res.ok ? await res.text() : undefined;
    if (opened !== fileOpened) return;
    if (text === undefined) return $("viewer-body").replaceChildren(el("p", "", "This file isn't available any more."));
    for (const line of text.split("\n")) list.append(el("li", "", line || " "));
    $("viewer-body").replaceChildren(list);
  }

  function apply(delta) {
    view.title = delta.title;
    view.running = delta.running;
    const before = new Map(delta.messages.map((m) => [m.id, messages.get(m.id)]));
    for (const m of delta.messages) messages.set(m.id, m);
    view.messages = delta.order.map((id) => messages.get(id)).filter(Boolean);
    if (delta.files) { view.files = delta.files; renderFiles(); }
    if (delta.suggestions) renderSuggestions(delta.suggestions);
    renderHead();
    renderMessages(delta.messages, before);
  }

  function end() {
    ended = true;
    document.querySelector("main").hidden = true;
    document.querySelector("header.titlebar").hidden = true;
    document.querySelector(".dock").hidden = true;
    $("ended").hidden = false;
  }

  function follow() {
    if (!window.EventSource) return void setInterval(poll, 3000);
    const events = new EventSource(base + "/events?guest=" + guestId + "&known=" + data.known);
    events.onmessage = (e) => apply(JSON.parse(e.data));
    events.addEventListener("ended", () => { events.close(); end(); });
    events.onerror = async () => {
      const res = await fetch(base + "/view").catch(() => null);
      if (res && res.status === 404) { events.close(); end(); }
    };
  }

  async function poll() {
    if (ended || document.hidden) return;
    const res = await fetch(base + "/view?guest=" + guestId).catch(() => null);
    if (!res) return;
    if (res.status === 404) return end();
    const next = await res.json();
    apply({ title: next.title, running: next.running, order: next.messages.map((m) => m.id), messages: next.messages, files: next.files, suggestions: next.suggestions });
  }

  $("suggest").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("name").value.trim();
    const text = $("text").value.trim();
    if (!name || !text) return;
    store("relay-guest-name", name);
    const button = $("send");
    button.disabled = true;
    $("status").textContent = "Sending…";
    try {
      const res = await fetch(base + "/suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guestId, name, text }) });
      if (res.status === 404) return end();
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't send that.");
      $("text").value = "";
      $("status").textContent = "Sent to the host. They decide what goes to the agent.";
    } catch (err) {
      $("status").textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
  $("text").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("suggest").requestSubmit();
  });
  $("viewer-close").addEventListener("click", () => $("viewer").close());
  $("lightbox").addEventListener("click", () => $("lightbox").close());
  // A picture in a message or an answer opens whole; a video plays where it is.
  $("messages").addEventListener("click", (e) => {
    const img = e.target.closest(".message-image img, .message-image, .markdown img");
    if (!img) return;
    const picture = img.tagName === "IMG" ? img : img.querySelector("img");
    if (picture && picture.src) showPicture(picture.src);
  });

  renderHead();
  renderFiles();
  renderSuggestions(view.suggestions || []);
  renderMessages(view.messages);
  scrollTo(0, document.body.scrollHeight);
  follow();
})();`;
