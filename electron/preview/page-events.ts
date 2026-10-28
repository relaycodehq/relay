import type { WebContents } from "electron";
import { faviconData } from "./favicon";
import { webUrl } from "./local-urls";

/** What a preview keeps from its page's events. */
export interface PageFacts {
  /** Why the last load failed, until another one starts. */
  error?: string;
  favicon?: string;
  /** The icon being loaded, so a slower earlier one doesn't win. */
  faviconRequest?: object;
}

/**
 * Follows what the page does: its loads and failures, its icon, where it
 * went. `current` says the page still belongs to the preview: an unloaded
 * page's last events mustn't speak for the next one.
 */
export function followPage(
  wc: WebContents,
  facts: PageFacts,
  {
    current,
    changed,
    navigated,
  }: {
    current: () => boolean;
    changed: () => void;
    /** It went to a web address, which the preview opens next time. */
    navigated: (url: string) => void;
  },
) {
  wc.setWindowOpenHandler(({ url }) => {
    // Links that open a window open here instead.
    if (webUrl(url)) void wc.loadURL(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e) => {
    if (!webUrl(e.url)) e.preventDefault();
  });
  wc.on("did-start-loading", () => {
    facts.error = undefined;
    changed();
  });
  wc.on("did-stop-loading", changed);
  wc.on("did-start-navigation", ({ isSameDocument, isMainFrame }) => {
    if (!isMainFrame || isSameDocument || !current()) return;
    facts.favicon = undefined;
    facts.faviconRequest = undefined;
    changed();
  });
  wc.on("page-favicon-updated", (_event, urls) => {
    if (!current()) return;
    const request = {};
    facts.faviconRequest = request;
    const icons = urls.filter(
      (url) => webUrl(url) || url.startsWith("data:image/"),
    );
    void faviconData(wc.session, icons).then((favicon) => {
      if (!current() || facts.faviconRequest !== request) return;
      facts.favicon = favicon;
      changed();
    });
  });
  const wentTo = () => {
    if (!current()) return;
    const url = wc.getURL();
    if (webUrl(url)) navigated(url);
    changed();
  };
  wc.on("did-navigate", wentTo);
  wc.on("did-navigate-in-page", wentTo);
  wc.on("page-title-updated", changed);
  wc.on("did-fail-load", (_e, code, description, url, mainFrame) => {
    // -3 is a load another one replaced.
    if (!mainFrame || code === -3 || !current()) return;
    facts.error = `${description} (${url})`;
    changed();
  });
  wc.on("render-process-gone", (_e, details) => {
    if (!current()) return;
    facts.error = `The page stopped: ${details.reason}.`;
    changed();
  });
}
