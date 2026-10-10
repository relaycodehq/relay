// relay-render://: serves the pages answers showed, and drafts being looked
// at, each as its own sandboxed document with no origin to reach Relay from.
import { protocol, session } from "electron";
import {
  injectRenderBootstrap,
  RENDER_CSP,
  RENDER_SCHEME,
} from "../../shared/html-render";

/** Before the app is ready: the scheme gets an origin of its own, like https. */
export function registerRenderScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: RENDER_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/** Drafts preview_html and show_html load before anything is saved, by one-off id. */
export const renderDrafts = new Map<string, string>();

/** In memory, for windows that look at a page zoomed. */
export const shotSession = () => session.fromPartition("relay-render-shots");

type ReadPage = (chatId: string, renderId: string, page: number) => Promise<string>;

export function serveRenders(read: ReadPage) {
  const serve = async (request: Request) => {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    let html: string | undefined;
    try {
      // A zoomed shot's draft comes from a host of its own; see lookAtPage.
      if ((url.host === "draft" || url.host.startsWith("shot-")) && parts.length === 1)
        html = renderDrafts.get(parts[0]);
      else if (url.host === "render" && parts.length === 3)
        html = await read(parts[0], parts[1], Number(parts[2]));
    } catch {}
    if (html === undefined) return new Response("Not found", { status: 404 });
    return new Response(injectRenderBootstrap(html), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": RENDER_CSP,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  };
  session.defaultSession.protocol.handle(RENDER_SCHEME, serve);
  shotSession().protocol.handle(RENDER_SCHEME, serve);
}
