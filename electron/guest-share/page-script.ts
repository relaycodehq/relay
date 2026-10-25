/**
 * The guest page's code. Message bodies arrive as HTML the server built with
 * everything escaped; anything else from the thread is set as text. No
 * backticks or `${` in here: it's one String.raw template.
 */
export const GUEST_SCRIPT = String.raw`(() => {
  const data = JSON.parse(document.getElementById("relay-guest-data").textContent);
  const base = location.pathname.replace(/\/+$/, "");
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const guestId = localStorage.getItem("relay-guest-id") || (() => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("relay-guest-id", id);
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

  $("name").value = localStorage.getItem("relay-guest-name") || "";
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
    box.replaceChildren(el("summary", "", activities.length + (activities.length === 1 ? " tool call" : " tool calls")));
    for (const a of activities) {
      const row = el("div", "call " + a.status);
      row.dataset.id = a.id;
      const line = el("div", "call-line" + (a.detail ? " open" : ""));
      line.append(el("span", "kind", kindLabel[a.kind] || a.kind), document.createTextNode(a.label));
      row.append(line);
      if (a.detail) {
        line.addEventListener("click", () => {
          const open = row.querySelector("pre");
          if (open) return open.remove();
          showDetail(row, m, a);
        });
        if (reading.has(a.id)) showDetail(row, m, a);
      }
      box.append(row);
    }
  }

  // New pages are added after the ones showing; moving a frame would reload it.
  function fillRenders(box, renders) {
    const showing = Array.from(box.children, (child) => child.dataset.id);
    const added = renders.slice(showing.length);
    if (showing.some((id, i) => !renders[i] || renders[i].id !== id)) return box.replaceChildren(...renders.map(renderFrame));
    box.append(...added.map(renderFrame));
  }

  function fillShots(box, m) {
    box.hidden = !((m.images && m.images.length) || m.preview);
    box.replaceChildren();
    for (const id of m.images || []) { const img = el("img"); img.dataset.media = id; img.alt = ""; box.append(img); }
    if (m.preview) { box.append(el("p", "", "Browser preview")); const img = el("img"); img.dataset.media = m.preview; img.alt = "Browser preview"; box.append(img); }
    hydrate(box);
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
      frame.src = base + "/render/" + r.id + "/" + i + theme;
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

  function messageNode(m) {
    const li = el("li");
    li.append(el("div", "msg-from", m.from), el("details", "calls"), el("div", "renders"), el("div", "msg-body"), el("div", "shots"));
    updateMessage(li, m, undefined);
    return li;
  }

  // Only the parts that changed are rebuilt: a streaming answer leaves its pages and open lists be.
  function updateMessage(li, m, before) {
    const same = (key) => before && JSON.stringify(before[key]) === JSON.stringify(m[key]);
    const part = (cls) => li.querySelector(":scope > ." + cls);
    li.className = "msg " + m.role + (m.streaming ? " streaming" : "");
    if (!same("activities")) fillCalls(part("calls"), m);
    if (!same("renders")) fillRenders(part("renders"), m.renders || []);
    if (!before || before.html !== m.html) { const body = part("msg-body"); body.innerHTML = m.html; hydrate(body); }
    if (!same("images") || !same("preview")) fillShots(part("shots"), m);
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
    const res = await fetch(base + "/file/" + id);
    if (!res.ok) return $("viewer-body").replaceChildren(el("p", "", "This file isn't available any more."));
    for (const line of (await res.text()).split("\n")) list.append(el("li", "", line || " "));
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
    document.querySelector("header.top").hidden = true;
    $("suggest").hidden = true;
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
    localStorage.setItem("relay-guest-name", name);
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

  renderHead();
  renderFiles();
  renderSuggestions(view.suggestions || []);
  renderMessages(view.messages);
  scrollTo(0, document.body.scrollHeight);
  follow();
})();`;
