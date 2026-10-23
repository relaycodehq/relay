/** Runs in the preview's isolated world. Returns a user-confirmed edit for durable storage. */
export const annotationRuntime = String.raw`
(annotations, newId, css, available) => new Promise((resolve) => {
  globalThis.__relayElementPicker?.cancel();
  const host = document.createElement("div");
  host.id = "relay-element-inspector";
  host.setAttribute("popover", "manual");
  // Closed, so the page's own scripts can't read or rewrite the comment.
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style);
  const make = (tag, className, parent = shadow) => {
    const node = document.createElement(tag);
    node.className = className;
    parent.append(node);
    return node;
  };
  const outline = make("div", "outline");
  const draftPin = make("div", "pin");
  draftPin.setAttribute("aria-hidden", "true");
  draftPin.style.pointerEvents = "none";
  const details = make("div", "details");
  details.setAttribute("role", "tooltip");
  const editor = make("div", "editor");
  editor.setAttribute("role", "group");
  editor.setAttribute("aria-label", "Browser comment");
  const input = make("textarea", "", editor);
  input.placeholder = "Add a comment…";
  input.setAttribute("aria-label", "Comment on element");
  input.maxLength = 2000;
  input.rows = 1;
  const button = (parent, className, label, text) => {
    const node = make("button", className, parent);
    node.type = "button";
    node.setAttribute("aria-label", label);
    node.title = label;
    node.textContent = text;
    return node;
  };
  const remove = button(editor, "", "Delete comment", "−");
  const cancel = button(editor, "", "Cancel comment", "×");
  const save = button(editor, "save", "Save comment", "✓");
  const status = make("div", "status");
  const statusText = make("span", "", status);
  const doneButton = button(status, "", "Finish annotating", "Done");
  document.documentElement.append(host);
  host.showPopover();
  let selected = null, hovered = null, editing = null, done = false, frame = 0;
  const live = new Map();
  const pins = annotations.map((annotation, index) => {
    const pin = button(shadow, "pin", "Edit comment " + (index + 1) + ": " + annotation.comment, String(index + 1));
    pin.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.preventDefault();
      const element = locate(annotation);
      if (element) select(element, annotation);
    });
    return { annotation, pin };
  });
  // A closed root hides its nodes from composedPath(), so ask the root what is under the pointer or focused.
  const ours = (node) => !!node && (editor.contains(node) || status.contains(node) || pins.some(({ pin }) => pin === node));
  const own = (event) => {
    if (event.target !== host) return false;
    const pointed = "clientX" in event && !(event.type === "click" && event.detail === 0);
    return pointed ? shadow.elementsFromPoint(event.clientX, event.clientY).some(ours) : ours(shadow.activeElement);
  };
  function textOf(element) {
    return (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  }
  function locate(annotation) {
    if (annotation.url !== location.href) return null;
    const remembered = live.get(annotation.id);
    if (remembered?.isConnected) return remembered;
    try {
      const matches = document.querySelectorAll(annotation.selector);
      const element = matches.length === 1 ? matches[0] : null;
      if (element && element.localName === annotation.tag.match(/^<([\w-]+)/)?.[1] && textOf(element) === annotation.text) {
        live.set(annotation.id, element);
        return element;
      }
    } catch {}
    return null;
  }
  function visible(rect) {
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }
  function place(node, x, y) {
    const box = node.getBoundingClientRect();
    node.style.left = Math.max(12, Math.min(x, innerWidth - box.width - 12)) + "px";
    node.style.top = Math.max(12, Math.min(y, innerHeight - box.height - 12)) + "px";
  }
  function render() {
    frame = 0;
    if (done) return;
    if (!host.isConnected) { finish(null); return; }
    let unavailable = 0;
    for (const { annotation, pin } of pins) {
      const element = locate(annotation);
      const rect = element?.getBoundingClientRect();
      if (!element || !rect || !visible(rect)) {
        pin.hidden = true;
        if (!element) unavailable++;
        continue;
      }
      pin.hidden = editing?.id === annotation.id;
      place(pin, rect.left + Math.min(rect.width / 2, 48), rect.top + Math.min(rect.height / 2, 42));
    }
    statusText.textContent = (available ? "Click an element to comment" : "Send or remove an attachment to add more") + (pins.length ? " · " + pins.length + " saved" : "") + (unavailable ? " · " + unavailable + " unavailable here" : "");
    const element = selected || hovered;
    const rect = element?.isConnected ? element.getBoundingClientRect() : null;
    outline.hidden = !rect || !visible(rect);
    draftPin.hidden = !selected || !rect || !visible(rect);
    editor.hidden = !selected || !rect || !visible(rect);
    details.hidden = !!selected || !rect || !visible(rect);
    if (!rect || !visible(rect)) return;
    const computed = getComputedStyle(element);
    Object.assign(outline.style, { left: rect.x + "px", top: rect.y + "px", width: rect.width + "px", height: rect.height + "px", borderRadius: computed.borderRadius });
    if (selected) {
      place(draftPin, rect.left + Math.min(rect.width / 2, 48), rect.top + Math.min(rect.height / 2, 42));
      place(editor, rect.left + Math.min(rect.width / 2, 48) + 24, rect.top + Math.min(rect.height / 2, 42));
      return;
    }
    const rgb = computed.color.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    const color = rgb ? "#" + rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase() : computed.color;
    details.replaceChildren();
    for (const [label, value] of [[element.localName, Math.round(rect.width) + "×" + Math.round(rect.height)], ["color", color], ["font", computed.fontSize + " " + computed.fontFamily]]) {
      const row = make("div", "", details);
      make("span", label === element.localName ? "tag" : "", row).textContent = label;
      make("b", "", row).textContent = value;
    }
    const height = details.getBoundingClientRect().height;
    place(details, rect.left, rect.top > height + 20 ? rect.top - height - 10 : rect.bottom + 10);
  }
  function schedule() { if (!done && !frame) frame = requestAnimationFrame(render); }
  function select(element, annotation = null) {
    if (!annotation && !available) return;
    selected = element;
    editing = annotation;
    input.value = annotation?.comment ?? "";
    remove.hidden = !annotation;
    save.disabled = !input.value.trim();
    input.style.height = "24px";
    render();
    input.focus({ preventScroll: true });
  }
  function deselect() { selected = editing = null; input.blur(); render(); }
  function selectorFor(element) {
    const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
    const generated = /\d{4,}|[0-9a-f]{6,}|__|^(css|sc|jsx|svelte)-/i;
    let selector = "";
    for (let el = element; el && el !== document.documentElement; el = el.parentElement) {
      let part = el.localName;
      const testId = el.getAttribute("data-testid");
      if (testId) part += '[data-testid="' + CSS.escape(testId) + '"]';
      else if (el.id && !generated.test(el.id)) part = "#" + CSS.escape(el.id);
      else part += [...el.classList].filter((c) => !generated.test(c)).slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
      // Lists repeat test ids, and pages sometimes ids, as often as classes.
      const siblings = el.parentElement ? [...el.parentElement.children] : [];
      if (siblings.filter((c) => c.matches(part)).length > 1) part += ":nth-of-type(" + (siblings.filter((c) => c.localName === el.localName).indexOf(el) + 1) + ")";
      selector = selector ? part + " > " + selector : part;
      if (unique(selector)) break;
    }
    return selector.length <= 2048 && unique(selector) ? selector : "";
  }
  function submit() {
    if (!selected?.isConnected || !input.value.trim()) return;
    const rect = selected.getBoundingClientRect();
    if (!visible(rect)) return;
    const html = selected.outerHTML;
    finish({ action: "save", annotation: {
      id: editing?.id ?? newId, url: location.href, selector: selectorFor(selected),
      tag: html.slice(0, html.indexOf(">") + 1).slice(0, 300),
      text: textOf(selected), comment: input.value.trim(),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: innerWidth, height: innerHeight }
    }});
  }
  function target(event) {
    const element = document.elementsFromPoint(event.clientX, event.clientY).find((node) => node !== host);
    if (!element || element === document.documentElement || element === document.body) return null;
    return element.closest("button,a,input,textarea,select,[role=button]") || element;
  }
  const move = (event) => { if (event.isTrusted && !selected && !own(event)) { hovered = target(event); schedule(); } };
  const click = (event) => {
    if (!event.isTrusted || own(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click" && event.button === 0) { const element = target(event); if (element) select(element); }
  };
  const key = (event) => {
    if (!event.isTrusted) return;
    if (own(event)) event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (selected) deselect(); else finish(null);
    } else if (own(event) && shadow.activeElement === input && event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); submit();
    }
  };
  // The overlay sits over the page and takes the wheel, so scroll what is under it by hand.
  const scrolls = (el, axis, delta) => {
    const style = getComputedStyle(el);
    const overflow = axis === "y" ? style.overflowY : style.overflowX;
    if (el !== document.scrollingElement && !/auto|scroll|overlay/.test(overflow)) return false;
    const at = axis === "y" ? el.scrollTop : el.scrollLeft;
    const max = axis === "y" ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
    return delta < 0 ? at > 0 : at < max - 1;
  };
  const wheel = (event) => {
    if (!event.isTrusted || own(event)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    const dx = event.deltaX * unit, dy = event.deltaY * unit;
    const under = document.elementsFromPoint(event.clientX, event.clientY).find((node) => node !== host);
    let scroller = document.scrollingElement;
    for (let el = under; el; el = el.parentElement)
      if ((dy && scrolls(el, "y", dy)) || (dx && scrolls(el, "x", dx))) { scroller = el; break; }
    scroller?.scrollBy(dx, dy);
  };
  input.addEventListener("input", () => {
    save.disabled = !input.value.trim();
    input.style.height = "24px";
    input.style.height = Math.min(120, input.scrollHeight) + "px";
    schedule();
  });
  save.addEventListener("click", (event) => { if (event.isTrusted) submit(); });
  cancel.addEventListener("click", (event) => { if (event.isTrusted) deselect(); });
  remove.addEventListener("click", (event) => { if (event.isTrusted && editing) finish({ action: "remove", id: editing.id }); });
  doneButton.addEventListener("click", (event) => { if (event.isTrusted) finish(null); });
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
  document.addEventListener("pointermove", move, true);
  const pointerEvents = ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "contextmenu"];
  for (const name of pointerEvents) document.addEventListener(name, click, true);
  document.addEventListener("keydown", key, true);
  document.addEventListener("wheel", wheel, { capture: true, passive: false });
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  function finish(result) {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("pointermove", move, true);
    for (const name of pointerEvents) document.removeEventListener(name, click, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("wheel", wheel, true);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    host.remove();
    delete globalThis.__relayElementPicker;
    resolve(result);
  }
  // Lives in the isolated world, out of the page's reach; tests reach the closed root through it.
  globalThis.__relayElementPicker = { id: newId, cancel: () => finish(null), shadow };
  render();
})
`;
