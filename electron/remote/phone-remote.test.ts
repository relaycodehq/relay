import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../app/store";
import { PhoneRemote } from "./phone-remote";
import type { RemoteHost } from "./bridge";
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
import {
  projectChatSendSchema,
  type ChatMessage,
  type ChatSummary,
  type ProjectChat,
} from "../../shared/projects";
import { recipient } from "../../shared/recipient";
import { composeSend, newThreadSettings } from "../../shared/remote-compose";
import { defaultAISettings } from "../../shared/settings";

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
  extra: Partial<Omit<RemoteHost, "name">> = {},
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-phone-")));
  const store = new Store(join(dir, "state"));
  await store.load();
  const fake = fakeHost(respond);
  const remote = new PhoneRemote(
    store,
    async (v) => "sealed:" + v,
    async (v) => v.slice(7),
    { ...fake.host, ...extra },
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
  // The answer moved the thread's summary, which main.ts hears separately.
  remote.chatsEvent({ projectId, chats: [summary] });
  await vi.waitFor(() =>
    expect(p.events.map((e) => e.kind)).toEqual(["message", "chats"]),
  );

  await remote.revoke(p.credentials()!.deviceId);
  await p.until("denied");
  expect(p.statuses.at(-1)?.detail).toMatch(/removed/);
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
  await vi.waitFor(
    () =>
      expect(p.statuses.map((s) => s.status)).toEqual([
        "connecting",
        "online",
        "offline",
        "connecting",
        "online",
      ]),
    { timeout: 4000 },
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

  await new Promise((r) => setTimeout(r, 1100));
  p.client.wake();
  expect(p.client.status).toBe("connecting");
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
  await p.client.desktop("sendProjectChat", chatId, send);
  const older = dispatched.at(-1)?.args[1];
  expect(older).not.toHaveProperty("to");
  expect(
    projectChatSendSchema.omit({ to: true }).strict().parse(older),
  ).toEqual(older);
  expect(recipient(older as typeof send)).toBe("codex");
});
