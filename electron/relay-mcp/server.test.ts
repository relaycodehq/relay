import { afterEach, expect, test } from "vitest";
import {
  relayToken,
  serveRelayTools,
  STARTED_PATH,
  toolText,
  verifyRelayToken,
} from ".";
import { BODY_LIMIT } from "./server";
import { RENDER_MAX_CHARS, RENDER_MAX_PAGES } from "../../shared/html-render";

const secret = "a".repeat(64);
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function serve(call: Parameters<typeof serveRelayTools>[1]["call"]) {
  const serving = serveRelayTools(0, {
    verify: (token) => verifyRelayToken(secret, token),
    call,
  });
  await serving.ready;
  close = serving.close;
  const { port } = serving.server.address() as { port: number };
  return `http://127.0.0.1:${port}/mcp`;
}

const post = (
  url: string,
  body: unknown,
  token = relayToken(secret, "chat-1"),
) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

test("a token names its thread only with the secret that signed it", () => {
  const token = relayToken(secret, "chat-1");
  expect(verifyRelayToken(secret, token)).toBe("chat-1");
  expect(verifyRelayToken("b".repeat(64), token)).toBeUndefined();
  expect(
    verifyRelayToken(secret, token.replace("chat-1", "chat-2")),
  ).toBeUndefined();
});

test("speaks enough MCP for a client to list and call the tools as its thread", async () => {
  const calls: unknown[] = [];
  const url = await serve(async (chatId, name, args) => {
    calls.push({ chatId, name, args });
    return toolText("ok");
  });
  const init = await post(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    },
  });
  expect((await init.json()).result).toMatchObject({
    protocolVersion: "2025-06-18",
    capabilities: { tools: {} },
  });
  const note = await post(url, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  expect(note.status).toBe(202);
  const list = await (
    await post(url, { jsonrpc: "2.0", id: 2, method: "tools/list" })
  ).json();
  expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
    "start_threads",
    "list_threads",
    "find_threads",
    "read_thread",
    "send_to_thread",
    "wait_for_threads",
    "stop_thread",
    "settle_thread",
    "usage_limits",
    "move_to_worktree",
    "list_projects",
    "add_project",
    "open_preview",
    "screenshot",
    "console_errors",
    "show_html",
    "preview_html",
  ]);
  expect(list.result.tools[0].inputSchema.properties.threads.type).toBe(
    "array",
  );
  const called = await (
    await post(url, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_threads", arguments: {} },
    })
  ).json();
  expect(called.result).toEqual(toolText("ok"));
  expect(calls).toEqual([{ chatId: "chat-1", name: "list_threads", args: {} }]);
});

test("turns away a caller without a thread's token", async () => {
  const url = await serve(async () => toolText("never"));
  expect(
    (await post(url, { jsonrpc: "2.0", id: 1, method: "tools/list" }, ""))
      .status,
  ).toBe(401);
  expect(
    (
      await post(
        url,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        "chat-1.forged",
      )
    ).status,
  ).toBe(401);
});

test("a started thread's path lists and answers only the tools that drive no other thread", async () => {
  const calls: string[] = [];
  const url = await serve(async (_chat, name) => {
    calls.push(name);
    return toolText("ok");
  });
  const started = url.replace(/\/mcp$/, STARTED_PATH);
  const list = await (
    await post(started, { jsonrpc: "2.0", id: 1, method: "tools/list" })
  ).json();
  expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual([
    "find_threads",
    "read_thread",
    "usage_limits",
    "move_to_worktree",
    "list_projects",
    "open_preview",
    "screenshot",
    "console_errors",
    "show_html",
    "preview_html",
  ]);
  const refused = await (
    await post(started, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "start_threads", arguments: {} },
    })
  ).json();
  expect(refused.error.code).toBe(-32602);
  expect(calls).toEqual([]);
});

test("a failing call comes back as a tool error, not a dead request", async () => {
  const url = await serve(async () => {
    throw new Error("That isn't a thread you started.");
  });
  const body = await (
    await post(url, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "stop_thread", arguments: { id: "x" } },
    })
  ).json();
  expect(body.result).toEqual(
    toolText("That isn't a thread you started.", true),
  );
});

test("takes show_html at its page cap, and says so when a body is over the limit", async () => {
  const calls: unknown[] = [];
  const url = await serve(async (_chat, _name, args) => {
    calls.push(args);
    return toolText("ok");
  });
  // Lines with quotes, which JSON escaping lengthens, up to the page cap.
  const line = '<div class="row" data-x="1">Příliš žluťoučký kůň</div>\n';
  const html = line.repeat(Math.floor(RENDER_MAX_CHARS / line.length));
  const variants = Array.from({ length: RENDER_MAX_PAGES }, (_, i) => ({
    label: `v${i}`,
    html,
  }));
  const call = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "show_html", arguments: { title: "t", variants } },
  };
  expect((await (await post(url, call)).json()).result).toEqual(toolText("ok"));
  expect(calls).toHaveLength(1);

  const over = await post(url, {
    ...call,
    params: {
      ...call.params,
      arguments: { title: "x".repeat(BODY_LIMIT), variants },
    },
  });
  expect(over.status).toBe(413);
  expect((await over.json()).error.message).toMatch(/over \d+ MB/);
  expect(calls).toHaveLength(1);
});

test("a caller that hangs up stops its call", async () => {
  let aborted!: () => void;
  const stopped = new Promise<void>((resolve) => (aborted = resolve));
  const url = await serve(
    (_chat, _name, _args, signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () => {
          aborted();
          resolve(toolText("Cancelled.", true));
        }),
      ),
  );
  const hangUp = new AbortController();
  const request = fetch(url, {
    method: "POST",
    signal: hangUp.signal,
    headers: { authorization: `Bearer ${relayToken(secret, "chat-1")}` },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "wait_for_threads", arguments: {} },
    }),
  }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 50));
  hangUp.abort();
  await request;
  await stopped;
});
