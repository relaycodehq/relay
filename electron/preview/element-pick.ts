import type { WebContents } from "electron";
import type { PickedElement } from "../../shared/preview";

// Chromium's own inspect highlight, over the DevTools protocol, so nothing
// is added to the page.
const HIGHLIGHT = {
  showInfo: true,
  showStyles: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.55 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.45 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.66 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.45 },
};
/** Room around the element in its picture. */
const MARGIN = 8;

interface Described {
  selector: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
}

/**
 * Runs on the picked element, in the page: a selector that finds only it,
 * preferring test ids and stable ids over generated class names, then where
 * it sits. Source text, since the main process has no DOM to type it with.
 */
const DESCRIBE = `function () {
  const unique = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const generated = /\\d{4,}|[0-9a-f]{6,}|__|^(css|sc|jsx|svelte)-/i;
  const part = (el) => {
    const tag = el.localName;
    const testId = el.getAttribute("data-testid");
    if (testId) return tag + '[data-testid="' + CSS.escape(testId) + '"]';
    if (el.id && !generated.test(el.id)) return "#" + CSS.escape(el.id);
    let own = tag + [...el.classList]
      .filter((c) => !generated.test(c))
      .slice(0, 2)
      .map((c) => "." + CSS.escape(c))
      .join("");
    const parent = el.parentElement;
    if (parent && [...parent.children].filter((c) => c.matches(own)).length > 1) {
      const sameTag = [...parent.children].filter((c) => c.localName === tag);
      own += ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
    }
    return own;
  };
  let selector = "";
  for (let el = this; el && el !== document.documentElement; el = el.parentElement) {
    const own = part(el);
    selector = selector ? own + " > " + selector : own;
    if (own.startsWith("#") || unique(selector)) break;
  }
  const html = this.outerHTML;
  const open = html.slice(0, html.indexOf(">") + 1 || html.length);
  const box = this.getBoundingClientRect();
  return {
    selector: unique(selector) ? selector : "",
    tag: open.length > 300 ? open.slice(0, 299) + "…" : open,
    text: (this.innerText ?? this.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 160),
    rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    viewport: { width: innerWidth, height: innerHeight },
  };
}`;

/** The element's box with a margin, kept inside the viewport; whole numbers. */
export function clipRect({ rect, viewport }: Pick<Described, "rect" | "viewport">) {
  const x = Math.max(0, Math.floor(rect.x - MARGIN));
  const y = Math.max(0, Math.floor(rect.y - MARGIN));
  const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + MARGIN));
  const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + MARGIN));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : undefined;
}

/** Waits for the user to click an element on the page; `cancel` gives up. */
export function pickElement(wc: WebContents) {
  const dbg = wc.debugger;
  let settle: (picked: PickedElement | null) => void = () => {};
  const result = new Promise<PickedElement | null>((r) => (settle = r));
  let done = false;
  const ownsDebugger = !dbg.isAttached();
  const send = (method: string, params?: object) =>
    dbg.sendCommand(method, params);

  const finish = async (picked: PickedElement | null) => {
    if (done) return;
    done = true;
    dbg.off("message", onMessage);
    dbg.off("detach", onDetach);
    wc.off("before-input-event", onKey);
    wc.off("did-start-navigation", onNavigate);
    if (dbg.isAttached()) {
      await send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} }).catch(() => {});
      await send("Overlay.hideHighlight").catch(() => {});
      if (ownsDebugger) dbg.detach();
    }
    settle(picked);
  };
  const cancel = () => void finish(null);

  const onMessage = (_e: unknown, method: string, params: any) => {
    if (method !== "Overlay.inspectNodeRequested") return;
    void (async () => {
      try {
        await send("Overlay.setInspectMode", { mode: "none", highlightConfig: {} });
        await send("Overlay.hideHighlight");
        const { object } = await send("DOM.resolveNode", {
          backendNodeId: params.backendNodeId,
        });
        const { result } = await send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          functionDeclaration: DESCRIBE,
          returnByValue: true,
        });
        await send("Runtime.releaseObject", { objectId: object.objectId }).catch(() => {});
        const described = result.value as Described;
        // A frame for the highlight to leave the picture.
        await new Promise((r) => setTimeout(r, 50));
        const clip = clipRect(described);
        const image = await wc.capturePage(clip);
        await finish({
          url: wc.getURL(),
          selector: described.selector,
          tag: described.tag,
          text: described.text,
          image: image.toDataURL(),
        });
      } catch (error) {
        console.warn("Picking an element failed:", error);
        await finish(null);
      }
    })();
  };
  const onDetach = () => void finish(null);
  const onKey = (event: Electron.Event, input: Electron.Input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };
  const onNavigate = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (details.isMainFrame && !details.isSameDocument) cancel();
  };

  void (async () => {
    try {
      if (ownsDebugger) dbg.attach("1.3");
      dbg.on("message", onMessage);
      dbg.on("detach", onDetach);
      wc.on("before-input-event", onKey);
      wc.on("did-start-navigation", onNavigate);
      await send("DOM.enable");
      await send("DOM.getDocument", { depth: 0 });
      await send("Overlay.enable");
      await send("Overlay.setInspectMode", {
        mode: "searchForNode",
        highlightConfig: HIGHLIGHT,
      });
      // Escape reaches the page only while it has the keyboard.
      wc.focus();
    } catch (error) {
      console.warn("Could not start picking an element:", error);
      await finish(null);
    }
  })();
  return { result, cancel };
}
