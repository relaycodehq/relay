import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../../electron/store";
import { PhoneRemote } from "../../electron/remote/phone-remote";
import type { RemoteHost } from "../../electron/remote/bridge";
import { RemoteClient, type RemoteStatus } from "../../shared/remote-client";
import {
  clientHandshake,
  fromBase64Url,
  toBase64Url,
} from "../../shared/remote-crypto";
import {
  parsePairingUrl,
  type PhoneTailnet,
  type RemoteCredentials,
  type RemoteEvent,
} from "../../shared/remote";
import type {
  ChatMessage,
  ChatSummary,
  ProjectChat,
} from "../../shared/projects";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const projectId = randomUUID(),
  chatId = randomUUID();

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
  return { host, dispatched, summary };
}

async function desktop(
  respond?: (method: string) => Promise<unknown>,
  tailnet: { current: PhoneTailnet } = {
    current: { status: "connected", addresses: ["127.0.0.1"] },
  },
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-phone-")));
  const store = new Store(join(dir, "state"));
  await store.load();
  const fake = fakeHost(respond);
  const remote = new PhoneRemote(
    store,
    async (v) => "sealed:" + v,
    async (v) => v.slice(7),
    fake.host,
    0,
    async () => tailnet.current,
  );
  if (tailnet.current.status === "connected") await remote.setEnabled(true);
  cleanup.push(async () => {
    await remote.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { remote, ...fake };
}

function phone(
  start: ConstructorParameters<typeof RemoteClient>[0]["start"],
  extra: Partial<ConstructorParameters<typeof RemoteClient>[0]> = {},
) {
  const statuses: { status: RemoteStatus; detail?: string }[] = [];
  const events: RemoteEvent[] = [];
  let credentials: RemoteCredentials | undefined;
  const client = new RemoteClient({
    start,
    timeoutMs: 2000,
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onEvent: (e) => events.push(e),
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
      vi.waitFor(() => expect(client.status).toBe(status), { timeout: 5000 }),
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

it("turns on only with Tailscale, and listens only while it's connected", async () => {
  const tailnet = {
    current: { status: "missing", addresses: [] } as PhoneTailnet,
  };
  const { remote } = await desktop(undefined, tailnet);
  await expect(remote.setEnabled(true)).rejects.toThrow("Tailscale");
  expect(await remote.state()).toMatchObject({
    enabled: false,
    listening: false,
  });

  tailnet.current = { status: "connected", addresses: ["127.0.0.1"] };
  await remote.setEnabled(true);
  expect((await remote.state()).hosts).toEqual(["127.0.0.1"]);
  // The code names only the tailnet address.
  expect(parsePairingUrl((await remote.pairing()).url)!.hosts).toEqual([
    "127.0.0.1",
  ]);

  // Tailscale goes off: nothing listens, and access comes back with it.
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
  await vi.waitFor(() =>
    expect(p.events.map((e) => e.kind)).toEqual(["message", "chats"]),
  );

  await remote.revoke(p.credentials()!.deviceId);
  await p.until("denied");
  expect(p.statuses.at(-1)?.detail).toMatch(/removed/);
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

it("waits longer for calls that push or write, and not for the rest", async () => {
  // Everything the desktop is asked takes a moment longer than a normal call may.
  const { remote } = await desktop(async (method) => {
    await new Promise((r) => setTimeout(r, 800));
    return method === "projectCommitMessage" ? "Fix the flaky test" : [];
  });
  const link = parsePairingUrl((await remote.pairing()).url)!;
  const p = phone(
    { link, device: "Pixel 7" },
    { timeoutMs: 500, slowTimeoutMs: 3000 },
  );
  await p.until("online");
  await expect(
    p.client.desktop("projectCommitMessage", projectId, ["a.ts"]),
  ).resolves.toBe("Fix the flaky test");
  await expect(p.client.desktop("projectFiles", projectId)).rejects.toThrow(
    "didn't answer in time",
  );
});
