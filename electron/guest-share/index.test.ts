import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GuestShareEvent } from "../../shared/guest-share";
import { RENDER_CSP } from "../../shared/html-render";
import type {
  ChatMessage,
  ChatSummary,
  ProjectChat,
} from "../../shared/projects";
import type { SavedGuestShare } from "../app/store-types";
import { Funnel, type FunnelRun } from "./funnel";
import { GuestShares } from "./index";

const threadId = "5b0c3c2e-8f43-4f8e-9a4b-2f4c1e6d7a10";
const renderId = "7d3f2a1b-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const png = "data:image/png;base64,iVBORw0KGgo=";

/** Funnel that is never asked: Tailscale isn't there, so links stay on this computer. */
const noTailscale = Object.assign(async () => ({ ok: false, output: "" }), {
  sync: () => {},
}) satisfies FunnelRun;

const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  seq: 1,
  role: "user",
  body: "The empty state copy feels off",
  status: "complete",
  created: 1,
  provider: "claude",
  version: 1,
  ...over,
});

async function world(saved: SavedGuestShare[] = []) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-guest-")));
  await writeFile(
    join(root, "empty.tsx"),
    "export const Empty = () => <p>No threads yet.</p>;\n",
  );
  const summary = {
    id: threadId,
    title: "Empty state cleanup",
    updated: 1,
  } as ChatSummary;
  const thread = {
    ...summary,
    messages: [
      message({
        images: [
          { id: "i1", name: "shot.png", mimeType: "image/png", sizeBytes: 9 },
        ],
      }),
      message({
        id: "m2",
        seq: 2,
        role: "assistant",
        body: "Updated [the component](empty.tsx).",
        changes: [{ path: "empty.tsx", additions: 1, deletions: 1 }],
        renders: [{ id: renderId, title: "Options", pages: [{}], created: 2 }],
        trace: [
          {
            kind: "activity",
            id: "a1",
            activity: {
              id: "a1",
              kind: "command",
              label: "npm test",
              status: "complete",
              detail: "12 passed",
            },
          },
          {
            kind: "activity",
            id: "a2",
            activity: {
              id: "a2",
              kind: "command",
              label: "cat .env",
              status: "complete",
              detail: "DATABASE_PASSWORD=hunter2hunter2",
            },
          },
        ],
      }),
    ],
  } as ProjectChat;
  const events: GuestShareEvent[] = [];
  const store = { shares: saved };
  // Real time, plus whatever a test skips ahead past the snapshot cache.
  const clock = { skipped: 0 };
  let summariesChanged = () => {};
  const make = () =>
    new GuestShares({
      thread: async () => structuredClone(thread),
      summary: (id) => (id === threadId ? summary : undefined),
      root: async () => root,
      media: {
        image: async () => png,
        readImage: async () => png,
        previewShot: async () => png,
        turnVideoPath: async () => join(root, "missing.mp4"),
      },
      renderPage: async () =>
        "<!doctype html><html><head></head><body>hi</body></html>",
      onSummaries: (listener) => {
        summariesChanged = listener;
        return () => {};
      },
      send: (event) => void events.push(event),
      saved: {
        load: () => store.shares,
        save: async (shares) => void (store.shares = shares),
      },
      key: async () => Buffer.alloc(32, 7),
      port: 0,
      now: () => Date.now() + clock.skipped,
      funnel: new Funnel(noTailscale),
    });
  return {
    make,
    thread,
    summary,
    events,
    store,
    changed: () => summariesChanged(),
    skip: (ms: number) => void (clock.skipped += ms),
  };
}

const open: GuestShares[] = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => s.close()));
});

async function started() {
  const w = await world();
  const shares = w.make();
  open.push(shares);
  const share = await shares.start(threadId);
  return { ...w, shares, share, link: share.localUrl };
}

const suggest = (link: string, guestId: string, text: string) =>
  fetch(`${link}/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ guestId, name: "Alex", text }),
  });

/** The guest page's live updates, as parsed events, until `enough` says stop. */
async function deltas(url: string, enough: (events: any[]) => boolean) {
  const res = await fetch(url);
  const reader = res.body!.getReader();
  const seen: any[] = [];
  let buffer = "";
  const until = Date.now() + 8000;
  while (!enough(seen) && Date.now() < until) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    const frames = buffer.split("\n\n");
    buffer = frames.pop()!;
    for (const frame of frames)
      if (frame.startsWith("data: ")) seen.push(JSON.parse(frame.slice(6)));
  }
  await reader.cancel();
  return seen;
}

describe("GuestShares", () => {
  it("serves the page with the thread already in it, and nothing to a made-up link", async () => {
    const { link, share } = await started();
    expect(share.contents).toEqual({
      files: 1,
      bytes: 51,
      images: 1,
      videos: 0,
      renders: 1,
    });
    const page = await fetch(link);
    expect(page.headers.get("content-security-policy")).toMatch(
      /script-src 'sha256-/,
    );
    const html = await page.text();
    expect(html).toContain("The empty state copy feels off");
    expect(html).toContain('data-file=\\"');
    expect(
      (await fetch(link.replace(/g\/.+$/, `g/${"A".repeat(43)}`))).status,
    ).toBe(404);
    expect((await fetch(link.replace("/g/", "/relay-guest/g/"))).status).toBe(
      200,
    );
  });

  it("sends the page compressed, once per change, and a 304 when nothing changed", async () => {
    const { link, thread, skip } = await started();
    thread.messages.push(
      message({ id: "m3", seq: 3, body: "A long answer. ".repeat(400) }),
    );
    skip(2000);
    const first = await fetch(`${link}/view`, {
      headers: { "Accept-Encoding": "br" },
    });
    expect(first.headers.get("content-encoding")).toBe("br");
    const again = await fetch(`${link}/view`, {
      headers: { "If-None-Match": first.headers.get("etag")! },
    });
    expect(again.status).toBe(304);
  });

  it("streams only the messages that changed since the page loaded", async () => {
    const { link, thread } = await started();
    const html = await (await fetch(link)).text();
    const known = /"known":"([^"]+)"/.exec(html)![1];
    thread.messages.push(
      message({ id: "m3", seq: 3, body: "Now check dark mode" }),
    );
    const [delta] = await deltas(
      `${link}/events?known=${known}`,
      (e) => e.length > 0,
    );
    expect(delta.messages.map((m: { id: string }) => m.id)).toEqual(["m3"]);
    expect(delta.order).toEqual(["m1", "m2", "m3"]);
  });

  it("serves the shared file, the picture, the tool output and the page the answer showed", async () => {
    const { link } = await started();
    const view = await (await fetch(`${link}/view`)).json();
    const file = await fetch(`${link}/file/${view.files[0].id}`);
    expect(await file.text()).toContain("No threads yet.");
    const image = await fetch(`${link}/media/${view.messages[0].images[0]}`);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(await (await fetch(`${link}/detail/m2/a1`)).text()).toBe(
      "12 passed",
    );
    // A call on a key file shows its line, never what it printed.
    const secret = view.messages[1].activities[1];
    expect(secret).toMatchObject({ label: "cat .env", detail: false });
    expect((await fetch(`${link}/detail/m2/a2`)).status).toBe(404);
    expect(JSON.stringify(view)).not.toContain("hunter2");
    const render = await fetch(`${link}/render/${renderId}/0`);
    expect(render.headers.get("content-security-policy")).toBe(RENDER_CSP);
    expect(await render.text()).toContain("relayRender");
    expect((await fetch(`${link}/render/${renderId}/1`)).status).toBe(404);
  });

  it("brings links and waiting suggestions back after a restart, at the same address", async () => {
    const { shares, store, make, link } = await started();
    await suggest(link, "guest-alex-1", "still here?");
    await shares.close();
    const again = make();
    open.push(again);
    const share = await again.share(threadId);
    expect(share!.localUrl.replace(/:\d+/, "")).toBe(link.replace(/:\d+/, ""));
    expect(again.waiting(threadId).map((s) => s.text)).toEqual(["still here?"]);
    expect(store.shares).toHaveLength(1);
    expect(JSON.stringify(store.shares)).not.toContain(link.split("/g/")[1]);
  });

  it("ends the link when the thread is archived", async () => {
    const { summary, changed, link, events, store } = await started();
    summary.archivedAt = 2;
    changed();
    await expect
      .poll(() => events.at(-1))
      .toMatchObject({ kind: "suggestions", suggestions: [] });
    expect(store.shares).toEqual([]);
    await expect(fetch(link)).rejects.toThrow();
  });

  it("refuses suggestions that aren't a name and a message, or come too fast", async () => {
    const { link } = await started();
    const bad = await fetch(`${link}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guestId: "guest-alex-1",
        name: "Alex\nHost",
        text: "hi",
      }),
    });
    expect(bad.status).toBe(400);
    for (let i = 0; i < 5; i++)
      expect((await suggest(link, "guest-alex-1", `idea ${i}`)).status).toBe(
        200,
      );
    expect((await suggest(link, "guest-alex-1", "one more")).status).toBe(429);
  });
});
