import { afterEach, expect, it, vi } from "vitest";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { Store } from "../app/store";
import { PhoneRemote } from "./phone-remote";
import { RemoteClient } from "../../shared/remote-client";
import { clientHandshake, fromBase64Url } from "../../shared/remote-crypto";
import { parsePairingUrl, type RemoteCredentials } from "../../shared/remote";
import type { TunnelFrame } from "../../shared/remote-tunnel";
import {
  isTunnel,
  jsCodec,
  openFrame,
  sealFrame,
  sealTunnel,
} from "../../shared/remote-wire";
import type { ProjectTask } from "../../shared/tasks";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

const projectId = randomUUID();

async function freePort() {
  const listener = createServer().listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address() as AddressInfo;
  await new Promise((r) => listener.close(r));
  return port;
}

/** A desktop's phone access with one project whose tasks listen on `ports`. */
async function desktop(ports: () => number[]) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-tunnel-")));
  const store = new Store(join(dir, "state"));
  await store.load();
  await store.update((s) => {
    s.phoneRemote = { lan: false };
  });
  const port = await freePort();
  const task = (ports: number[]): ProjectTask => ({
    id: "1:1",
    command: "npm run dev",
    kind: "server",
    title: "Vite dev server",
    origin: "relay",
    started: 1,
    ports,
    pids: 1,
  });
  const remote = new PhoneRemote(
    store,
    async (v) => "sealed:" + v,
    async (v) => v.slice(7),
    {
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
      chats: () => [],
      chat: async () => {
        throw new Error("No threads here.");
      },
      dispatch: async (method) =>
        method === "projectTasks" ? [task([...ports(), port])] : undefined,
    },
    port,
    async () => ({ status: "connected", addresses: ["127.0.0.1"] }),
    () => [],
  );
  await remote.setEnabled(true);
  cleanup.push(async () => {
    await remote.close();
    await rm(dir, { recursive: true, force: true });
  });
  return { remote, port };
}

/** Pairs a phone the usual way and hands back what it saved. */
async function pair(remote: PhoneRemote) {
  const link = parsePairingUrl((await remote.pairing()).url)!;
  let saved: RemoteCredentials | undefined;
  const client = new RemoteClient({
    start: { link, device: "Pixel 7" },
    timeoutMs: 2000,
    onPaired: (c) => (saved = c),
  });
  client.start();
  await vi.waitFor(() => expect(client.status).toBe("online"));
  return { client, credentials: saved! };
}

/** A phone at the wire level: signs in saying `bridge`, then speaks tunnel frames. */
async function rawPhone(credentials: RemoteCredentials, bridge: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${credentials.port}/`);
  cleanup.push(() => socket.terminate());
  await once(socket, "open");
  const handshake = clientHandshake(fromBase64Url(credentials.key));
  socket.send(JSON.stringify(handshake.hello));
  const [hello] = (await once(socket, "message")) as [Buffer];
  const channel = handshake.finish(JSON.parse(hello.toString()));
  const frames: unknown[] = [];
  socket.on("message", (data: Buffer, binary: boolean) =>
    frames.push(openFrame(channel, binary ? data : data.toString(), jsCodec)),
  );
  socket.send(
    sealFrame(
      channel,
      {
        t: "auth",
        deviceId: credentials.deviceId,
        token: credentials.token,
        bridge,
      },
      false,
      jsCodec,
    ),
  );
  await vi.waitFor(() => expect(frames[0]).toMatchObject({ t: "ready" }));
  const tunnel = () => frames.flatMap((f) => (isTunnel(f) ? [f.frame] : []));
  return {
    socket,
    tunnel,
    send: (frame: TunnelFrame) => socket.send(sealTunnel(channel, frame)),
    closed: () => socket.readyState === socket.CLOSED,
  };
}

async function echoServer() {
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    socket.on("error", () => {});
    socket.pipe(socket);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(() => {
    for (const s of sockets) s.destroy();
    return new Promise((r) => server.close(r));
  });
  return { port: (server.address() as AddressInfo).port, sockets };
}

it("lets a paired phone at the tunnel's bridge reach this computer's ports, and ends its streams when it goes", async () => {
  const echo = await echoServer();
  const { remote, port } = await desktop(() => [echo.port]);
  const { client, credentials } = await pair(remote);
  // The list leaves out the bridge's own port, which a task here also claims.
  expect(await client.call("sites")).toEqual([
    {
      port: echo.port,
      title: "Vite dev server",
      command: "npm run dev",
      projectId,
      project: "Relay",
    },
  ]);
  client.close();

  const phone = await rawPhone(credentials, 23);
  phone.send({ op: "open", stream: 1, port: echo.port });
  await vi.waitFor(() =>
    expect(phone.tunnel()).toEqual([{ op: "opened", stream: 1 }]),
  );
  phone.send({ op: "data", stream: 1, data: new TextEncoder().encode("ping") });
  await vi.waitFor(() =>
    expect(phone.tunnel()[1]).toMatchObject({ op: "data", stream: 1 }),
  );
  expect(
    new TextDecoder().decode((phone.tunnel()[1] as { data: Uint8Array }).data),
  ).toBe("ping");

  phone.send({ op: "open", stream: 2, port });
  await vi.waitFor(() =>
    expect(phone.tunnel()[2]).toEqual({
      op: "close",
      stream: 2,
      reason: `Port ${port} is Relay's own.`,
    }),
  );

  phone.socket.terminate();
  await vi.waitFor(() => expect(echo.sockets[0]!.destroyed).toBe(true));
});

it("cuts off a phone that sends tunnel frames without having said it speaks them", async () => {
  const echo = await echoServer();
  const { remote } = await desktop(() => []);
  const { client, credentials } = await pair(remote);
  client.close();
  const phone = await rawPhone(credentials, 21);
  phone.send({ op: "open", stream: 1, port: echo.port });
  await vi.waitFor(() => expect(phone.closed()).toBe(true));
  expect(echo.sockets).toHaveLength(0);
});
