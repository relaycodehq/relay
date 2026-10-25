import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { writeUploadChunk } from "../drafts";
import { networkInterfaces, tmpdir } from "node:os";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../app/store";
import { PhoneRemote } from "./phone-remote";
import { lanAddresses } from "./lan";
import type { RemoteSettings } from "../app/store-types";
import type { RemoteHost } from "./bridge";
import {
  RemoteClient,
  Unanswered,
  type RemoteStatus,
} from "../../shared/remote-client";
import {
  clientHandshake,
  fromBase64Url,
  toBase64Url,
} from "../../shared/remote-crypto";
import {
  parsePairingUrl,
  type ClientFrame,
  type PhoneTailnet,
  type RemoteCredentials,
  type RemoteEvent,
} from "../../shared/remote";
import {
  projectChatSendSchema,
  type ChatMessage,
  type ChatSummary,
  type ProjectChat,
} from "../../shared/projects";
import { recipient } from "../../shared/recipient";
import { composeSend, newThreadSettings } from "../../shared/remote-compose";
import { defaultAISettings } from "../../shared/settings";
import { MessageBatches } from "./message-batches";

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.useRealTimers();
  while (cleanup.length) await cleanup.pop()!();
  vi.restoreAllMocks();
});

const projectId = randomUUID(),
  chatId = randomUUID();

/** Check retained history immediately, then wake only when another observation arrives. */
function observations() {
  const waiting = new Set<() => void>();
  cleanup.push(async () => waiting.clear());
  return {
    notify: () => {
      for (const check of waiting) check();
    },
    until: (matches: () => boolean) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (!matches()) return;
          waiting.delete(check);
          resolve();
        };
        waiting.add(check);
        check();
      }),
  };
}

function fakeHost(respond?: (method: string) => Promise<unknown>) {
  const dispatched: { method: string; args: unknown[] }[] = [];
  const summary: ChatSummary = {
    id: chatId,
    projectId,
    title: "Fix the flaky test",
    scope: { kind: "project" },
    created: 1,
    updated: 2,
  };
  const chat: ProjectChat = {
    ...summary,
    messages: [],
    lastInput: {
      id: randomUUID(),
      body: "earlier",
      provider: "claude",
      choice: {
        model: "claude-opus-5-5",
        fast: false,
        reasoningEffort: "high",
      },
      runtimeMode: "approval-required",
      interactionMode: "default",
    },
  };
  const host: Omit<RemoteHost, "name"> = {
    projects: async () => [
      {
        id: projectId,
        name: "Relay",
        path: "/tmp/relay",
        repository: null,
        added: 1,
      },
    ],
    projectPath: () => "/tmp/relay",
    chats: () => [summary],
    chat: async () => structuredClone(chat),
    dispatch: async (method, args) => {
      dispatched.push({ method, args });
      return respond?.(method);
    },
  };
  return { host, dispatched, summary, chat };
}

async function desktop(
  respond?: (method: string) => Promise<unknown>,
  tailnet: { current: PhoneTailnet } = {
    current: { status: "connected", addresses: ["127.0.0.1"] },
  },
  extra: Partial<Omit<RemoteHost, "name">> = {},
  lan: () => string[] = () => [],
  settings: RemoteSettings = { lan: false },
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-phone-")));
  const store = new Store(join(dir, "state"));
  await store.load();
  await store.update((s) => {
    s.phoneRemote = settings;
  });
  // Keep the port across listener restarts, just as the desktop does.
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const { port } = listener.address() as { port: number };
      listener.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
  const fake = fakeHost(respond);
  const remote = new PhoneRemote(
    store,
    async (v) => "sealed:" + v,
    async (v) => v.slice(7),
    { ...fake.host, ...extra },
    port,
    async () => tailnet.current,
    lan,
  );
  if (tailnet.current.status === "connected") await remote.setEnabled(true);
  cleanup.push(async () => {
    await remote.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { remote, store, ...fake };
}

function phone(
  start: ConstructorParameters<typeof RemoteClient>[0]["start"],
  extra: Partial<ConstructorParameters<typeof RemoteClient>[0]> = {},
) {
  const statuses: { status: RemoteStatus; detail?: string }[] = [];
  const events: RemoteEvent[] = [];
  const observed = observations();
  let credentials: RemoteCredentials | undefined;
  const client = new RemoteClient({
    start,
    timeoutMs: 2000,
    onStatus: (status, detail) => {
      statuses.push({ status, detail });
      observed.notify();
    },
    onEvent: (e) => {
      events.push(e);
      observed.notify();
    },
    onPaired: (c) => (credentials = c),
    ...extra,
  });
  cleanup.push(async () => client.close());
  client.start();
  return {
    client,
    events,
    statuses,
    credentials: () => credentials,
    until: (status: RemoteStatus) =>
      observed.until(() => client.status === status),
    untilEvents: (matches: (events: RemoteEvent[]) => boolean) =>
      observed.until(() => matches(events)),
  };
}

it("pairs from the QR link, then reconnects with the saved token", async () => {
  const { remote, dispatched } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const first = phone({ link, device: "Pixel 7" });
  await first.until("online");
  const credentials = first.credentials()!;
  expect(credentials.deviceId).toBe(remote.devices.list()[0]!.id);
  expect((await remote.state()).devices[0]).toMatchObject({
    name: "Pixel 7",
    online: true,
  });

  const overview = await first.client.call("overview");
  expect(overview.chats.map((c) => c.title)).toEqual(["Fix the flaky test"]);
  first.client.close();

  // The code was single-use; the token is what brings the phone back.
  const again = phone(credentials);
  await again.until("online");
  // The thread carries what its next message goes out with.
  const thread = await again.client.call("chat", chatId);
  expect(thread.settings).toEqual({
    provider: "claude",
    choice: { model: "claude-opus-5-5", fast: false, reasoningEffort: "high" },
    runtimeMode: "approval-required",
    interactionMode: "default",
  });
  expect(thread.root).toBe("/tmp/relay");
  await again.client.desktop("cancelProjectChat", chatId);
  // A left-out optional argument must not arrive as null, which the desktop refuses.
  await again.client.desktop(
    "projectChatQueueAction",
    chatId,
    "remove",
    chatId,
    undefined,
  );
  expect(dispatched).toEqual([
    { method: "cancelProjectChat", args: [chatId] },
    { method: "projectChatQueueAction", args: [chatId, "remove", chatId] },
  ]);
});

it("without the local network, listens on Tailscale only while it's connected", async () => {
  const tailnet = {
    current: { status: "connected", addresses: ["127.0.0.1"] } as PhoneTailnet,
  };
  const { remote } = await desktop(undefined, tailnet);
  expect((await remote.state()).lan).toBe(false);
  expect((await remote.state()).hosts).toEqual(["127.0.0.1"]);
  // The code names only the tailnet address.
  expect(parsePairingUrl((await remote.pairing()).url)!.hosts).toEqual([
    "127.0.0.1",
  ]);

  // Tailscale goes off: only `relay pipe` on this computer reaches it, and
  // access comes back with it.
  tailnet.current = { status: "stopped", addresses: [] };
  await remote.start();
  expect(await remote.state()).toMatchObject({
    enabled: true,
    listening: false,
    hosts: [],
  });
  await expect(remote.pairing()).rejects.toThrow();
  tailnet.current = { status: "connected", addresses: ["127.0.0.1"] };
  await remote.start();
  const phone1 = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel 7",
  });
  await phone1.until("online");
});

it("listens on the local network when allowed, Tailscale or not", async () => {
  const tailnet = {
    current: { status: "missing", addresses: [] } as PhoneTailnet,
  };
  const { remote } = await desktop(
    undefined,
    tailnet,
    {},
    () => ["127.0.0.1"],
    {},
  );
  // Without Tailscale, turning access on lets in the local network.
  await remote.setEnabled(true);
  expect(await remote.state()).toMatchObject({
    lan: true,
    listening: true,
    hosts: ["127.0.0.1"],
  });
  const link = parsePairingUrl((await remote.pairing()).url)!;
  expect(link.hosts).toEqual(["127.0.0.1"]);
  const p = phone({ link, device: "Pixel 7" });
  await p.until("online");
  expect(p.credentials()!.hosts).toEqual(["127.0.0.1"]);

  // Tailscale comes up: the local address stays first, Tailscale's follows.
  tailnet.current = { status: "connected", addresses: ["100.100.1.2"] };
  await remote.start();
  expect((await remote.state()).hosts).toEqual(["127.0.0.1", "100.100.1.2"]);

  // Without the local network and Tailscale gone, nothing listens.
  tailnet.current = { status: "missing", addresses: [] };
  await remote.setLan(false);
  expect(await remote.state()).toMatchObject({ listening: false, hosts: [] });
});

it("defaults to LAN with Tailscale present, and an old pairing learns it on reconnect", async () => {
  const tailnet = {
    current: {
      status: "connected",
      addresses: ["100.100.1.2"],
    } as PhoneTailnet,
  };
  const { remote, store } = await desktop(
    undefined,
    tailnet,
    {},
    () => ["127.0.0.1"],
    {},
  );
  expect(await remote.state()).toMatchObject({ lan: true, listening: true });
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await p.until("online");
  const saved = p.credentials()!;
  p.client.close();
  const key = store.get().phoneRemote!.key;

  // A pre-LAN pairing knows only its old route. Signing in adds LAN without a new token.
  let learned: RemoteCredentials | undefined;
  const again = phone(
    { ...saved, hosts: ["100.100.1.2"], routes: ["tailscale", "local"] },
    {
      WebSocket: routed(new Set(["100.100.1.2", "127.0.0.1"])),
      onCredentials: (c) => {
        learned = c;
      },
    },
  );
  await again.until("online");
  expect(learned).toMatchObject({
    hosts: ["127.0.0.1", "100.100.1.2"],
    token: saved.token,
    deviceId: saved.deviceId,
    routes: ["tailscale", "local"],
  });
  expect(again.client.route).toEqual({
    host: "100.100.1.2",
    kind: "tailscale",
  });
  expect((await again.client.call("overview")).projects[0].id).toBe(projectId);
  expect(store.get().phoneRemote!.key).toBe(key);
  expect(remote.devices.list()).toHaveLength(1);
});

const interfaceHost = lanAddresses(networkInterfaces())[0];

it.skipIf(!interfaceHost)(
  "pairs and reconnects through a real LAN interface with no Tailscale",
  async () => {
    const { remote, summary } = await desktop(
      undefined,
      { current: { status: "missing", addresses: [] } },
      {},
      () => [interfaceHost!],
      {},
    );
    await remote.setEnabled(true);
    const link = parsePairingUrl((await remote.pairing()).url)!;
    expect(link.hosts).toEqual([interfaceHost]);
    const p = phone({ link, device: "LAN phone" });
    await p.until("online");
    expect(p.client.route).toEqual({ host: interfaceHost, kind: "local" });
    expect((await p.client.call("overview")).chats[0].id).toBe(chatId);
    const saved = p.credentials()!;
    p.client.close();
    const again = phone(saved);
    await again.until("online");
    expect(again.client.route).toEqual({ host: interfaceHost, kind: "local" });
    await again.client.call("overview");
    summary.title = "Updated over LAN";
    remote.chatsEvent({ projectId, chats: [summary] });
    await again.untilEvents((events) =>
      events.some(
        (e) => e.kind === "chats" && e.chats[0]?.title === "Updated over LAN",
      ),
    );
    await remote.setLan(false);
    await again.until("offline");
    expect((await remote.state()).listening).toBe(false);
    await remote.setLan(true);
    again.client.wake();
    await again.until("online");
    expect(again.client.route?.host).toBe(interfaceHost);
    await again.client.call("overview");
    expect(remote.devices.list()).toHaveLength(1);
  },
);

it("preserves explicit LAN off across enabling, offline Tailscale and startup", async () => {
  const tailnet = {
    current: { status: "missing", addresses: [] } as PhoneTailnet,
  };
  const { remote } = await desktop(undefined, tailnet, {}, () => ["127.0.0.1"]);
  await remote.setEnabled(true);
  await remote.start();
  expect(await remote.state()).toMatchObject({
    enabled: true,
    lan: false,
    listening: false,
  });
  tailnet.current = { status: "connected", addresses: ["127.0.0.1"] };
  await remote.start();
  expect(await remote.state()).toMatchObject({
    lan: false,
    listening: true,
    hosts: ["127.0.0.1"],
  });
  await remote.setEnabled(false);
  await remote.setEnabled(true);
  expect((await remote.state()).lan).toBe(false);
});

it("resumes previously enabled access with no saved LAN choice and no Tailscale", async () => {
  const { remote } = await desktop(
    undefined,
    { current: { status: "missing", addresses: [] } },
    {},
    () => ["127.0.0.1"],
    { enabled: true },
  );
  await remote.start();
  expect(await remote.state()).toMatchObject({
    enabled: true,
    lan: true,
    listening: true,
  });
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Phone",
  });
  await p.until("online");
  await p.client.call("overview");
});

it("refreshes a connected phone's saved routes after LAN addresses change", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let hosts = ["127.0.0.1"];
  const changedHost = interfaceHost ?? "localhost";
  const { remote } = await desktop(
    undefined,
    { current: { status: "missing", addresses: [] } },
    {},
    () => hosts,
    {},
  );
  await remote.setEnabled(true);
  let learned: RemoteCredentials | undefined;
  const updates: RemoteCredentials[] = [];
  const p = phone(
    { link: parsePairingUrl((await remote.pairing()).url)!, device: "Phone" },
    {
      onCredentials: (c) => {
        learned = c;
        updates.push(c);
      },
    },
  );
  await p.until("online");
  hosts = [changedHost];
  await vi.advanceTimersByTimeAsync(15_000);
  await vi.waitFor(() =>
    expect(
      updates.some(
        (c) => c.hosts.join(",") === [changedHost, "127.0.0.1"].join(","),
      ),
    ).toBe(true),
  );
  // A route update can move the link without an offline transition or changing its token.
  await vi.waitFor(() => expect(p.client.route?.host).toBe(changedHost));
  expect(learned).toMatchObject({
    hosts: [changedHost],
    token: p.credentials()!.token,
    deviceId: p.credentials()!.deviceId,
  });
  expect(p.statuses.filter((s) => s.status !== "online")).toEqual([
    { status: "connecting", detail: undefined },
  ]);
  await p.client.call("overview");
  p.client.close();
  const again = phone(learned!);
  await again.until("online");
  expect(again.client.route?.host).toBe(changedHost);
  await again.client.call("overview");
});

/**
 * Names stand in for routes: each maps to the desktop on 127.0.0.1 while
 * `up`, and to a socket that never answers, like a LAN address on another
 * network, while not.
 */
function routed(up: Set<string>) {
  return function Routed(url: string) {
    const target = new URL(url);
    if (up.has(target.hostname)) {
      target.hostname = "127.0.0.1";
      return new WebSocket(target.toString());
    }
    return { send() {}, close() {}, binaryType: "arraybuffer" };
  } as unknown as typeof WebSocket;
}

it("tries the next route when one doesn't answer, and keeps the desktop's addresses", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const first = phone({ link, device: "Pixel 7" });
  await first.until("online");
  const saved = first.credentials()!;
  first.client.close();

  let learned: RemoteCredentials | undefined;
  const p = phone(
    { ...saved, hosts: ["192.168.9.9", "100.100.1.2"] },
    {
      WebSocket: routed(new Set(["100.100.1.2"])),
      staggerMs: 50,
      timeoutMs: 10_000,
      onCredentials: (c) => (learned = c),
    },
  );
  // Well before the dead route's timeout.
  await p.until("online");
  expect(p.client.route).toEqual({ host: "100.100.1.2", kind: "tailscale" });
  // The desktop's address and the one that worked; the dead one is gone.
  expect(learned?.hosts).toEqual(["127.0.0.1", "100.100.1.2"]);
});

it("pairs over whichever route answers, sending the one-time code only once", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  // A LAN address from another network ahead of the one that works.
  const away = phone(
    { link: { ...link, hosts: ["192.168.9.9", "100.100.1.2"] }, device: "Pixel" },
    { WebSocket: routed(new Set(["100.100.1.2"])), staggerMs: 50, timeoutMs: 10_000 },
  );
  await away.until("online");
  away.client.close();

  // Both answer: one sends the code, the other steps aside instead of being refused.
  const both = parsePairingUrl((await remote.pairing()).url)!;
  const home = phone(
    { link: { ...both, hosts: ["home.lan", "100.100.1.2"] }, device: "Pixel 2" },
    {
      WebSocket: routed(new Set(["home.lan", "100.100.1.2"])),
      staggerMs: 0,
      timeoutMs: 10_000,
    },
  );
  await home.until("online");
  expect(home.statuses.map((s) => s.status)).not.toContain("denied");
  expect(remote.devices.list().map((d) => d.name)).toEqual(["Pixel", "Pixel 2"]);
});

it("moves to an earlier route once it answers, without going offline", async () => {
  // Both routes, as a desktop with the local network on names them.
  const { remote } = await desktop(
    undefined,
    { current: { status: "connected", addresses: ["100.100.1.2"] } },
    {},
    () => ["127.0.0.1"],
  );
  await remote.setLan(true);
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const first = phone({ link, device: "Pixel 7" });
  await first.until("online");
  const saved = first.credentials()!;
  first.client.close();

  const up = new Set(["100.100.1.2"]);
  const p = phone(
    { ...saved, hosts: ["home.lan", "100.100.1.2"] },
    { WebSocket: routed(up), staggerMs: 50, timeoutMs: 10_000 },
  );
  await p.until("online");
  expect(p.client.route?.kind).toBe("tailscale");

  // Home again: the local address answers, and coming back looks for it.
  up.add("127.0.0.1");
  p.client.wake();
  await vi.waitFor(() => expect(p.client.route?.kind).toBe("local"));
  await p.client.call("overview");

  // Tailscale first, by choice: back the other way.
  p.client.setRoutes(["tailscale", "local"]);
  await vi.waitFor(() => expect(p.client.route?.kind).toBe("tailscale"));
  await p.client.call("overview");
  const after = p.statuses.slice(
    p.statuses.findIndex((s) => s.status === "online"),
  );
  expect(after.every((s) => s.status === "online")).toBe(true);
});

it("won't pair with a desktop whose key differs from the QR code's", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const other = toBase64Url(new Uint8Array(32).fill(9));
  const p = phone({ link: { ...link, key: other }, device: "Pixel" });
  await vi.waitFor(() =>
    expect(p.statuses.some((s) => s.status === "offline")).toBe(true),
  );
  expect(p.client.status).not.toBe("online");
  expect(remote.devices.list()).toEqual([]);
});

it("streams thread changes to the phone and cuts it off when removed", async () => {
  const { remote, summary } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  await p.client.call("overview");

  const message: ChatMessage = {
    id: randomUUID(),
    role: "assistant",
    body: "Done.",
    status: "complete",
    created: 3,
    provider: "claude",
    version: 1,
  };
  summary.updated = 3;
  remote.chatEvent({ chatId, message });
  // The answer moved the thread's summary, which main.ts hears separately.
  remote.chatsEvent({ projectId, chats: [summary] });
  await vi.waitFor(() =>
    expect(p.events.map((e) => e.kind)).toEqual(["message", "chats"]),
  );

  await remote.revoke(p.credentials()!.deviceId);
  await p.until("denied");
  expect(p.statuses.at(-1)?.detail).toMatch(/removed/);
});

it("holds a phone's events while it's in the background, and sends them the moment it's back", async () => {
  const { remote, summary } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  await p.client.call("overview");
  // Only the phone apps send this; this client stands in for one.
  const background = (on: boolean) =>
    (p.client as unknown as { sendFrame(frame: ClientFrame): void }).sendFrame({
      t: "background",
      on,
    });

  background(true);
  // Answered after the frame before it was handled.
  await p.client.call("overview");
  remote.chatEvent({
    chatId,
    message: {
      id: randomUUID(),
      role: "assistant",
      body: "Looking",
      status: "streaming",
      created: 3,
      provider: "claude",
      version: 1,
    },
  });
  remote.chatsEvent({ projectId, chats: [summary] });
  // Sent while not batching, the events would have come before this answer.
  await p.client.call("overview");
  expect(p.events).toEqual([]);

  background(false);
  await p.untilEvents((events) => events.length === 2);
  expect(p.events.map((e) => e.kind).sort()).toEqual(["chats", "message"]);
});

it("stays connected when the phone's own event listener throws", async () => {
  const { remote, summary } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let heard = 0;
  const p = phone(
    { link, device: "Pixel" },
    {
      onEvent: () => {
        heard++;
        throw new Error("a bug in a screen");
      },
    },
  );
  await p.until("online");
  await p.client.call("overview");
  remote.chatsEvent({ projectId, chats: [summary] });
  await vi.waitFor(() => expect(heard).toBe(1));
  summary.updated = 9;
  remote.chatsEvent({ projectId, chats: [summary] });
  await vi.waitFor(() => expect(heard).toBe(2));
  expect(p.client.status).toBe("online");
  expect(p.statuses.map((s) => s.status)).not.toContain("offline");
  warn.mockRestore();
});

it("ends the session of a phone removed without being cut off", async () => {
  const { remote, dispatched } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  // As when the removal lands mid sign-in and `disconnect` finds no session.
  await remote.devices.revoke(p.credentials()!.deviceId);
  await expect(p.client.call("overview")).rejects.toThrow();
  await p.until("denied");
  expect(p.statuses.at(-1)?.detail).toMatch(/removed/);
  expect(dispatched).toEqual([]);
});

it("keeps a phone trying when its sign-in can't be checked, and says no only to a bad token", async () => {
  const { remote, store } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const first = phone({ link, device: "Pixel" });
  await first.until("online");
  const credentials = first.credentials()!;
  first.client.close();

  // As when saving lastSeen fails for a moment.
  const verify = vi.spyOn(remote.devices, "verify");
  const save = vi
    .spyOn(store, "update")
    .mockRejectedValueOnce(new Error("EBUSY"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const again = phone(credentials);
  await again.until("online");
  expect(verify).toHaveBeenCalledTimes(2);
  expect(again.statuses.map((s) => s.status)).not.toContain("denied");

  save.mockClear().mockRejectedValue(new Error("EBUSY"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const wrong = phone({ ...credentials, token: "not-the-token" });
  await wrong.until("denied");
  const missing = phone({ ...credentials, deviceId: randomUUID() });
  await missing.until("denied");
  expect(wrong.statuses.at(-1)?.detail).toBe(missing.statuses.at(-1)?.detail);
  expect(save).not.toHaveBeenCalled();
  const calls = verify.mock.calls.length;
  const statuses = [wrong.statuses.slice(), missing.statuses.slice()];
  await vi.advanceTimersByTimeAsync(1100);
  expect([wrong.statuses, missing.statuses]).toEqual(statuses);
  expect(verify).toHaveBeenCalledTimes(calls);
});

it("does not retry or expose unexpected authentication failures", async () => {
  const { remote } = await desktop();
  const first = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await first.until("online");
  first.client.close();
  const verify = vi
    .spyOn(remote.devices, "verify")
    .mockRejectedValue(new Error("private internal detail"));
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const again = phone(first.credentials()!);
  await again.until("denied");
  expect(again.statuses.at(-1)?.detail).not.toContain(
    "private internal detail",
  );
  const statuses = again.statuses.slice();
  again.client.wake();
  await vi.advanceTimersByTimeAsync(1100);
  expect(again.statuses).toEqual(statuses);
  expect(verify).toHaveBeenCalledTimes(1);
});

it("drops forged and cross-session replayed sign-ins before token verification", async () => {
  const { remote } = await desktop();
  const first = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await first.until("online");
  const credentials = first.credentials()!;
  first.client.close();
  const verify = vi.spyOn(remote.devices, "verify");
  let recorded!: Uint8Array;
  const attack = (
    payload: (
      channel: ReturnType<ReturnType<typeof clientHandshake>["finish"]>,
    ) => Uint8Array | undefined,
  ) =>
    new Promise<void>((resolve, reject) => {
      const handshake = clientHandshake(fromBase64Url(credentials.key));
      const socket = new WebSocket(`ws://127.0.0.1:${credentials.port}/`);
      cleanup.push(async () => socket.close());
      socket.onopen = () => socket.send(JSON.stringify(handshake.hello));
      socket.onerror = () => reject(new Error("socket error"));
      socket.onclose = () => resolve();
      socket.onmessage = (message) => {
        const channel = handshake.finish(JSON.parse(message.data));
        const bytes = payload(channel);
        if (bytes) socket.send(toBase64Url(bytes));
        else socket.close();
      };
    });
  const auth = JSON.stringify({
    t: "auth",
    deviceId: credentials.deviceId,
    token: credentials.token,
  });
  await attack((channel) => {
    const forged = channel.seal(auth);
    forged[0]! ^= 1;
    return forged;
  });
  await attack((channel) => {
    recorded = channel.seal(auth);
    return undefined;
  });
  await attack(() => recorded);
  expect(verify).not.toHaveBeenCalled();
});

it("gives up on a quiet link at once, even when the socket never finishes closing", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  // A dead network: the close handshake never completes, so onclose never comes.
  class Stuck extends WebSocket {
    close() {}
  }
  const p = phone(
    { link, device: "Pixel" },
    { WebSocket: Stuck, staleMs: 500 },
  );
  await p.until("online");
  // The desktop ticks every 15s, so it's silent for longer than staleMs.
  await vi.waitFor(() =>
    expect(p.statuses.map((s) => s.status)).toEqual([
      "connecting",
      "online",
      "offline",
      "connecting",
      "online",
    ]),
  );
});

it("reconnects on coming back when the link went quiet meanwhile", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" }, { staleMs: 2000 });
  await p.until("online");
  // Just heard from: coming back keeps the link.
  p.client.wake();
  expect(p.client.status).toBe("online");

  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1100);
  p.client.wake();
  expect(p.client.status).toBe("connecting");
  now.mockRestore();
  await p.until("online");
  await p.client.call("overview");
});

it("only answers the allowlisted calls, and only after pairing", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  await expect(
    // @ts-expect-error: not a phone method
    p.client.call("openTerminal", "/", 80, 24),
  ).rejects.toThrow("Phones can't do that.");
  // The desktop's own calls: only those on the phone's list get through.
  for (const blocked of ["openTerminal", "saveProjectFile", "saveAISettings"])
    await expect(
      p.client.call("desktop", blocked as "aiSettings", []),
    ).rejects.toThrow();
  await expect(p.client.call("chat", "not-a-uuid")).rejects.toThrow();

  // A socket that finishes the handshake but skips pairing gets turned away.
  const handshake = clientHandshake(fromBase64Url(link.key));
  const socket = new WebSocket(`ws://127.0.0.1:${link.port}/`);
  const reply = await new Promise<string>((resolve, reject) => {
    let channel: ReturnType<typeof handshake.finish> | undefined;
    socket.onopen = () => socket.send(JSON.stringify(handshake.hello));
    socket.onerror = () => reject(new Error("socket error"));
    socket.onmessage = (m) => {
      if (!channel) {
        channel = handshake.finish(JSON.parse(m.data));
        socket.send(
          toBase64Url(
            channel.seal(
              JSON.stringify({
                t: "call",
                id: 1,
                method: "overview",
                args: [],
              }),
            ),
          ),
        );
      } else resolve(channel.open(fromBase64Url(m.data)));
    };
  });
  socket.close();
  expect(JSON.parse(reply)).toEqual({
    t: "denied",
    reason: "Pair this phone first.",
  });
});

it("lets a phone read, tick and remove a thread's notes and see its preview, but not a paired computer", async () => {
  const notes = [{ id: "n1", text: "- a\n- b", created: 1, updated: 1 }];
  const { remote, dispatched } = await desktop(async (method) =>
    method === "threadNotes"
      ? notes
      : method === "projectChatPreviewShot"
        ? "data:image/jpeg;base64,AA=="
        : [],
  );
  const pair = async (device: string, kind?: "computer") => {
    const link = parsePairingUrl((await remote.pairing()).url)!;
    const p = phone({ link, device, ...(kind ? { kind } : {}) });
    await p.until("online");
    return p.client;
  };
  const p = await pair("Pixel");
  expect(await p.call("desktop", "threadNotes", [chatId])).toEqual(notes);
  await p.call("desktop", "tickThreadNote", [chatId, "n1", 2, true]);
  await p.call("desktop", "removeThreadNote", [chatId, "n1"]);
  const messageId = randomUUID();
  expect(
    await p.call("image", { kind: "preview", chatId, messageId }, 600),
  ).toMatch(/^data:image\/jpeg/);
  // Keeping, pinning and reordering stay on the desktop.
  for (const blocked of [
    "keepThreadNote",
    "pinThreadMessage",
    "arrangeThreadNote",
  ])
    await expect(
      p.call("desktop", blocked as "threadNotes", [chatId]),
    ).rejects.toThrow();

  // A paired computer hands threads over; it doesn't reach into them.
  const computer = await pair("Studio", "computer");
  await expect(
    computer.call("desktop", "threadNotes", [chatId]),
  ).rejects.toThrow("Computers can't do that.");
  await expect(
    computer.call("image", { kind: "preview", chatId, messageId }, 600),
  ).rejects.toThrow("Computers can't do that.");
  expect(dispatched).toEqual([
    { method: "threadNotes", args: [chatId] },
    { method: "tickThreadNote", args: [chatId, "n1", 2, true] },
    { method: "removeThreadNote", args: [chatId, "n1"] },
    { method: "projectChatPreviewShot", args: [chatId, messageId] },
  ]);
});

it("lets a phone in past sockets someone holds open without a handshake", async () => {
  const { remote } = await desktop();
  const link = parsePairingUrl((await remote.pairing()).url)!;
  // More than the server takes at once, all sitting idle.
  const idle: WebSocket[] = [];
  cleanup.push(async () => idle.forEach((s) => s.close()));
  for (let i = 0; i < 30; i++) {
    const socket = new WebSocket(`ws://127.0.0.1:${link.port}/`);
    idle.push(socket);
    await new Promise((settle) => {
      socket.onopen = settle;
      socket.onclose = settle;
    });
  }
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  await p.client.call("overview");
  // It got in by pushing out the oldest, not by waiting for them all to time out.
  expect(idle.some((s) => s.readyState === WebSocket.OPEN)).toBe(true);
});

it("lets a phone see the desktop's version and update it, but not take threads", async () => {
  const asked: string[] = [];
  const { remote } = await desktop(undefined, undefined, {
    version: () => "0.3.1",
    handoffs: {
      handle: async (method) => {
        asked.push(method);
        return method === "computerInfo"
          ? {
              version: "0.3.1",
              bridge: 11,
              update: { status: "idle", current: "0.3.1" },
            }
          : { status: "checking", current: "0.3.1" };
      },
    },
  });
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  expect((await p.client.call("overview")).version).toBe("0.3.1");
  expect((await p.client.call("computerInfo")).version).toBe("0.3.1");
  expect((await p.client.call("updateNow")).status).toBe("checking");
  await expect(p.client.call("computerProjects")).rejects.toThrow(
    "Only a paired computer can do that.",
  );
  expect(asked).toEqual(["computerInfo", "updateNow"]);
});

it("waits longer for calls that push, write or send, and not for the rest", async () => {
  let dispatched!: () => void;
  let finish!: () => void;
  // Hold dispatch until the normal call deadline has passed on the controlled clock.
  const { remote } = await desktop(async (method) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
      dispatched();
    });
    return method === "projectCommitMessage" ? "Fix the flaky test" : [];
  });
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone(
    { link, device: "Pixel 7" },
    { timeoutMs: 500, slowTimeoutMs: 3000 },
  );
  await p.until("online");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const delayedCall = async (call: () => Promise<unknown>) => {
    const arrived = new Promise<void>((resolve) => (dispatched = resolve));
    const result = call();
    await arrived;
    await vi.advanceTimersByTimeAsync(501);
    finish();
    return result;
  };
  await expect(
    delayedCall(() =>
      p.client.desktop("projectCommitMessage", projectId, ["a.ts"]),
    ),
  ).resolves.toBe("Fix the flaky test");
  // A first send makes the worktree and may carry screenshots: no "Not sent" while it does.
  const send = composeSend(newThreadSettings(defaultAISettings), "hi", {
    id: randomUUID(),
  });
  await expect(
    delayedCall(() => p.client.desktop("sendProjectChat", chatId, send)),
  ).resolves.toBeDefined();
  // Gone unanswered, it may have run all the same, and says so.
  const arrived = new Promise<void>((resolve) => (dispatched = resolve));
  const late = p.client
    .desktop("projectFiles", projectId)
    .catch((error: unknown) => error);
  await arrived;
  await vi.advanceTimersByTimeAsync(501);
  expect(await late).toBeInstanceOf(Unanswered);
  expect(((await late) as Error).message).toContain("didn't answer in time");
  finish();
});

it("checks unanswered sends while dispatch runs, after reconnect, and outside the history page", async () => {
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => (finish = resolve));
  const { remote, dispatched, chat } = await desktop(async () => gate);
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await p.until("online");
  const send = composeSend(newThreadSettings(defaultAISettings), "hi", {
    id: randomUUID(),
  });
  const sending = p.client.desktop("sendProjectChat", chatId, send);
  const unanswered = sending.catch((e: unknown) => e);
  await vi.waitFor(() => expect(dispatched).toHaveLength(1));
  const receipt = (client: RemoteClient, id = send.id) =>
    client.call("chat", chatId, undefined, 1, id);
  expect(await receipt(p.client)).toMatchObject({
    hasSend: true,
    sendPending: true,
  });
  p.client.close();
  expect(await unanswered).toBeInstanceOf(Unanswered);
  const again = phone(p.credentials()!);
  await again.until("online");
  expect((await receipt(again.client)).hasSend).toBe(true);
  // Two requests with this id share one dispatch, even across a reconnect.
  const retry = again.client.desktop("sendProjectChat", chatId, send);
  expect((await receipt(again.client)).hasSend).toBe(true);
  expect(dispatched).toHaveLength(1);
  chat.messages = Array.from({ length: 102 }, (_, i): ChatMessage => ({
    id: i === 0 ? send.id : randomUUID(),
    role: "user",
    body: "hi",
    provider: "codex",
    status: "complete",
    created: i,
    version: 1,
  }));
  finish();
  await retry;
  const checked = await receipt(again.client);
  expect(checked.sendPending).toBe(false);
  expect(checked.messages).toHaveLength(1);
  expect(checked.messages[0]).not.toMatchObject({ id: send.id });
  expect(checked.hasSend).toBe(true);
  // An old accepted send that predates this bridge session is checked through the full history too.
  const old = randomUUID();
  chat.messages[0].id = old;
  expect((await receipt(again.client, old)).hasSend).toBe(true);
  expect((await receipt(again.client, randomUUID())).hasSend).toBe(false);
  chat.queue = [{ input: { ...send, id: randomUUID() }, created: 1 }];
  chat.scheduled = [
    {
      input: { ...send, id: randomUUID() },
      created: 1,
      at: Date.now() + 60000,
    },
  ];
  expect((await receipt(again.client, chat.queue[0].input.id)).hasSend).toBe(
    true,
  );
  expect(
    (await receipt(again.client, chat.scheduled[0].input.id)).hasSend,
  ).toBe(true);
});

it("doesn't revive a taken-back queue item when its phone retries after reconnecting", async () => {
  const { remote, dispatched, chat } = await desktop();
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await p.until("online");
  const send = composeSend(newThreadSettings(defaultAISettings), "queued", {
    id: randomUUID(),
  });
  chat.queue = [{ input: send, created: 1 }];
  await p.client.desktop("sendProjectChat", chatId, send);
  chat.queue = [];
  p.client.close();
  const again = phone(p.credentials()!);
  await again.until("online");
  expect(
    await again.client.call("chat", chatId, undefined, 1, send.id),
  ).toMatchObject({ hasSend: true, sendPending: false });
  await again.client.desktop("sendProjectChat", chatId, send);
  expect(dispatched).toHaveLength(1);
  // The receipt belongs to this thread, not every thread that might carry the same message id.
  await again.client.desktop("sendProjectChat", randomUUID(), send);
  expect(dispatched).toHaveLength(2);
});

it("keeps a desktop rejection distinct from an unanswered call and releases its receipt", async () => {
  const { remote } = await desktop(async () => {
    throw new Error("The queue is full.");
  });
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await p.until("online");
  const send = composeSend(newThreadSettings(defaultAISettings), "hi", {
    id: randomUUID(),
  });
  const error = await p.client
    .desktop("sendProjectChat", chatId, send)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(Unanswered);
  expect((error as Error).message).toBe("The queue is full.");
  expect(
    (await p.client.call("chat", chatId, undefined, 1, send.id)).hasSend,
  ).toBe(false);
});

it("sends ten screenshots directly and automatically batches forty into one idempotent send", async () => {
  const { remote, dispatched } = await desktop();
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Image batch",
  });
  await p.until("online");
  const image = {
    name: "shot.png",
    mimeType: "image/png" as const,
    dataUrl: `data:image/png;base64,${"A".repeat(1_066_664)}`,
  };
  const images = Array.from({ length: 10 }, (_, n) => ({
    ...image,
    name: `shot-${n}.png`,
  }));
  const send = composeSend(
    newThreadSettings(defaultAISettings),
    "Review all ten",
    { id: randomUUID(), images },
  );
  await p.client.desktop("sendProjectChat", chatId, send);
  const delivered = projectChatSendSchema.parse(dispatched.at(-1)?.args[1]);
  expect(delivered.images).toEqual(images);
  expect(dispatched).toHaveLength(1);

  const batched = {
    ...send,
    id: randomUUID(),
    images: Array.from({ length: 40 }, () => image),
  };
  await p.client.desktop("sendProjectChat", chatId, batched);
  expect(projectChatSendSchema.parse(dispatched.at(-1)?.args[1])).toEqual(
    batched,
  );
  expect(dispatched).toHaveLength(2);
  // Retrying the same send after an ambiguous reply must not submit it twice.
  await p.client.desktop("sendProjectChat", chatId, batched);
  expect(dispatched).toHaveLength(2);
  expect(batched.images).toHaveLength(40);
  expect(p.client.status).toBe("online");
  // The upload's many sealed frames leave the channel ready for ordinary calls.
  expect((await p.client.call("overview")).chats[0]?.id).toBe(chatId);
});

it("never dispatches an interrupted image upload and retries it whole after reconnect", async () => {
  const { remote, dispatched } = await desktop();
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Interrupted upload",
  });
  await p.until("online");
  const send = composeSend(
    newThreadSettings(defaultAISettings),
    "Keep every screenshot: čau 🌍",
    {
      id: randomUUID(),
      images: Array.from({ length: 20 }, (_, n) => ({
        name: `shot-${n}.jpg`,
        mimeType: "image/jpeg" as const,
        dataUrl: `data:image/jpeg;base64,${"A".repeat(1_066_664)}`,
      })),
    },
  );
  const accept = MessageBatches.prototype.accept;
  const interruption = vi
    .spyOn(MessageBatches.prototype, "accept")
    .mockImplementation(function (this: MessageBatches, frame) {
      if (frame.n === 1) p.client.close();
      return accept.call(this, frame);
    });
  await expect(
    p.client.desktop("sendProjectChat", chatId, send),
  ).rejects.toBeInstanceOf(Unanswered);
  expect(dispatched).toHaveLength(0);
  expect(send.images).toHaveLength(20);
  interruption.mockRestore();
  const retry = phone(p.credentials()!);
  await retry.until("online");
  await retry.client.desktop("sendProjectChat", chatId, send);
  expect(dispatched).toHaveLength(1);
  expect(projectChatSendSchema.parse(dispatched[0].args[1])).toEqual(send);
});

it("says who answers in `to` only to desktops that take it", async () => {
  const { remote, dispatched } = await desktop();
  const p = phone({
    link: parsePairingUrl((await remote.pairing()).url)!,
    device: "Pixel",
  });
  await p.until("online");
  const send = composeSend(newThreadSettings(defaultAISettings), "hi", {
    id: randomUUID(),
  });
  await p.client.desktop("sendProjectChat", chatId, send);
  expect(dispatched.at(-1)?.args[1]).toEqual(send);
  // A desktop from before `to` names no version in its handshake, and
  // refuses fields it doesn't know; the body's mention tells it the same.
  Reflect.set(p.client, "bridge", undefined);
  await p.client.desktop("sendProjectChat", chatId, {
    ...send,
    id: randomUUID(),
  });
  const older = dispatched.at(-1)?.args[1];
  expect(older).not.toHaveProperty("to");
  expect(
    projectChatSendSchema.omit({ to: true }).strict().parse(older),
  ).toEqual(older);
  expect(recipient(older as typeof send)).toBe("codex");
});

/** A phone from before `compactBridge`: base64 text both ways, and it never says its bridge. */
async function olderPhone(
  port: number,
  key: string,
  credentials: RemoteCredentials,
) {
  const handshake = clientHandshake(fromBase64Url(key));
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  cleanup.push(async () => socket.close());
  const frames: any[] = [];
  const observed = observations();
  let binary = 0;
  let channel: ReturnType<typeof handshake.finish> | undefined;
  const send = (frame: unknown) =>
    socket.send(toBase64Url(channel!.seal(JSON.stringify(frame))));
  socket.onopen = () => socket.send(JSON.stringify(handshake.hello));
  socket.onmessage = (m) => {
    if (typeof m.data !== "string") return void binary++;
    if (!channel) {
      channel = handshake.finish(JSON.parse(m.data));
      const { deviceId, token } = credentials;
      return send({ t: "auth", deviceId, token });
    }
    const frame = JSON.parse(channel.open(fromBase64Url(m.data)));
    frames.push(frame);
    observed.notify();
    if (frame.t === "ready")
      send({ t: "call", id: 1, method: "overview", args: [] });
  };
  await observed.until(() => frames.some((f) => f.t === "result"));
  const events = (): RemoteEvent[] =>
    frames.flatMap((f) => (f.t === "event" ? [f.event] : []));
  return {
    binary: () => binary,
    events,
    untilEvents: (matches: (events: RemoteEvent[]) => boolean) =>
      observed.until(() => matches(events())),
  };
}

it("streams patches to a current phone that add up to what an older one gets whole", async () => {
  const chats: ChatSummary[] = [];
  const { remote, summary } = await desktop(undefined, undefined, {
    chats: () => chats,
  });
  chats.push(summary);
  const pair = async (device: string) => {
    const link = parsePairingUrl((await remote.pairing()).url)!;
    const p = phone({ link, device });
    await p.until("online");
    return { link, credentials: p.credentials()!, p };
  };
  const old = await pair("Old phone");
  old.p.client.close();
  const current = await pair("Pixel");
  await current.p.client.call("overview");
  const older = await olderPhone(old.link.port, old.link.key, old.credentials);

  const id = randomUUID();
  const words =
    "Looked at the flaky test and found a race in the watcher. ".repeat(40);
  const trace: NonNullable<ChatMessage["trace"]> = [];
  const snapshot = (n: number, status: ChatMessage["status"]): ChatMessage => ({
    id,
    role: "assistant",
    body: words.slice(0, n * 400),
    status,
    created: 3,
    provider: "claude",
    version: 1,
    trace: structuredClone(trace),
  });
  for (let n = 1; n <= 5; n++) {
    trace.push({
      kind: "commentary",
      id: `c${n}`,
      text: `Step ${n}: reading the watcher.`,
    });
    remote.chatEvent({ chatId, message: snapshot(n, "streaming") });
    // Both clients received this step before the next enters the throttle.
    const received = (events: RemoteEvent[]) =>
      events.filter((e) => e.kind === "message").length >= n;
    await Promise.all([
      current.p.untilEvents(received),
      older.untilEvents(received),
    ]);
    expect(current.p.events.filter((e) => e.kind === "message")).toHaveLength(
      n,
    );
    expect(older.events().filter((e) => e.kind === "message")).toHaveLength(n);
  }
  remote.chatEvent({ chatId, message: snapshot(6, "complete") });
  chats.push({ ...summary, id: randomUUID(), title: "Another", updated: 5 });
  remote.chatsEvent({ projectId, chats });
  summary.title = "Fixed the flaky test";
  summary.updated = 6;
  remote.chatsEvent({ projectId, chats });

  const done = (events: RemoteEvent[]) =>
    events.filter((e) => e.kind === "chats").length === 2 &&
    events.some((e) => e.kind === "message" && e.message.status === "complete");
  await Promise.all([current.p.untilEvents(done), older.untilEvents(done)]);
  expect(current.p.events).toEqual(older.events());
  expect(current.p.events.filter((e) => e.kind === "message")).toHaveLength(6);
  expect(older.binary()).toBe(0);
});

it("headless startup watches initially disconnected Tailscale and respects saved disabled access", async () => {
  const tailnet: { current: PhoneTailnet } = {
    current: { status: "missing", addresses: [] },
  };
  const { remote } = await desktop(undefined, tailnet);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    await remote.start(true);
    expect((await remote.state()).enabled).toBe(true);
    expect((await remote.state()).listening).toBe(false);
    tailnet.current = { status: "connected", addresses: ["127.0.0.1"] };
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(async () =>
      expect((await remote.state()).listening).toBe(true),
    );
    await remote.setEnabled(false);
    await remote.start(true);
    expect((await remote.state()).enabled).toBe(false);
    expect((await remote.state()).listening).toBe(false);
    await remote.close();
  } finally {
    vi.useRealTimers();
  }
});

it("carries manual unread marks in overview and live summaries, and clears them", async () => {
  const { remote, summary } = await desktop();
  summary.markedUnread = true;
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel" });
  await p.until("online");
  expect((await p.client.call("overview")).chats[0].markedUnread).toBe(true);
  delete summary.markedUnread;
  remote.chatsEvent({ projectId, chats: [summary] });
  await vi.waitFor(() =>
    expect(
      p.events.some((e) => e.kind === "chats" && !e.chats[0].markedUnread),
    ).toBe(true),
  );
});

it("tells only phones that know drafts when one changes; older ones would take it for a message", async () => {
  const { remote, summary } = await desktop();
  const pair = async (device: string) => {
    const link = parsePairingUrl((await remote.pairing()).url)!;
    const p = phone({ link, device });
    await p.until("online");
    return { link, credentials: p.credentials()!, p };
  };
  const old = await pair("Old phone");
  old.p.client.close();
  const current = await pair("Pixel");
  await current.p.client.call("overview");
  const older = await olderPhone(old.link.port, old.link.key, old.credentials);

  remote.draftChanged({ key: chatId, draft: null });
  await current.p.untilEvents((events) => events.some((e) => e.kind === "draft"));
  // What comes after the draft reaches the older phone, so the draft had its chance to.
  remote.chatsEvent({ projectId: summary.projectId, chats: [] });
  await older.untilEvents((events) => events.some((e) => e.kind === "chats"));
  expect(older.events().some((e) => e.kind === "draft")).toBe(false);
});

it("tells only phones that know drafts when someone leaves the computer; older ones would take it for a message", async () => {
  let present = true;
  const chats: ChatSummary[] = [];
  const { remote, summary } = await desktop(undefined, undefined, {
    chats: () => chats,
    present: () => present,
  });
  chats.push(summary);
  const pair = async (device: string) => {
    const link = parsePairingUrl((await remote.pairing()).url)!;
    const p = phone({ link, device });
    await p.until("online");
    return { link, credentials: p.credentials()!, p };
  };
  const old = await pair("Old phone");
  old.p.client.close();
  const current = await pair("Pixel");
  await current.p.client.call("overview");
  const older = await olderPhone(old.link.port, old.link.key, old.credentials);

  present = false;
  summary.updated++;
  remote.chatsEvent({ projectId, chats });
  await current.p.untilEvents((events) =>
    events.some((e) => e.kind === "presence" && !e.present),
  );
  // What comes after leaving reaches the older phone, so leaving had its chance to.
  summary.updated++;
  remote.chatsEvent({ projectId, chats });
  await older.untilEvents(
    (events) => events.filter((e) => e.kind === "chats").length === 2,
  );
  expect(older.events().some((e) => e.kind === "presence")).toBe(false);
});

it("carries agent tool inspection through the desktop bridge without adding a forwarding destination", async () => {
  const inventory = {
    skills: { items: [] },
    servers: { items: [] },
    checkedAt: 1,
  };
  const { remote, dispatched } = await desktop(async () => inventory);
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const paired = phone({ link, device: "Tools inspector" });
  await paired.until("online");
  expect(await paired.client.desktop("agentTools", projectId, "codex")).toEqual(
    inventory,
  );
  await paired.client.desktop("agentTools", projectId, "codex", randomUUID());
  expect(dispatched).toEqual([
    { method: "agentTools", args: [projectId, "codex"] },
    { method: "agentTools", args: [projectId, "codex"] },
  ]);
});

it("takes a phone's file in chunks through the real socket", async () => {
  const uploads = await mkdtemp(join(tmpdir(), "relay-phone-uploads-"));
  cleanup.push(() => rm(uploads, { recursive: true, force: true }));
  const { remote } = await desktop(undefined, undefined, {
    uploadFile: (id, name, size, offset, bytes) =>
      writeUploadChunk(id, name, size, offset, bytes, uploads),
  });
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone({ link, device: "Pixel 7" });
  await p.until("online");
  const id = randomUUID();
  const chunk = (text: string) => Buffer.from(text).toString("base64");
  expect(
    await p.client.call("uploadFile", id, "clip.mp4", 6, 0, chunk("abc")),
  ).toEqual({ received: 3 });
  const done = await p.client.call(
    "uploadFile",
    id,
    "clip.mp4",
    6,
    3,
    chunk("def"),
  );
  expect(await readFile(done.path!, "utf8")).toBe("abcdef");
});
