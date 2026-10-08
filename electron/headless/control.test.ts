import { expect, it } from "vitest";
import { chmod, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  callControl,
  NotRunning,
  serveControl,
  type ControlApi,
} from "./control";
import { controlSocket } from "./paths";

it("answers the relay command over a socket only this user can open", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-control-")));
  const path = controlSocket(dir);
  try {
    await expect(callControl(path, "projects")).rejects.toBeInstanceOf(
      NotRunning,
    );
    const api = {
      projects: async () => [{ id: "p1", name: "Cache", path: "/src/cache" }],
      removeProject: async (id: string) => {
        throw new Error(`No project ${id}.`);
      },
      call: async (method: string, args: unknown[]) => ({ method, args }),
    } as unknown as ControlApi;
    const server = await serveControl(path, api);
    try {
      expect(await callControl(path, "projects")).toEqual([
        { id: "p1", name: "Cache", path: "/src/cache" },
      ]);
      await expect(callControl(path, "removeProject", "p2")).rejects.toThrow(
        "No project p2.",
      );
      expect(await callControl(path, "call", "aiSettings", [1])).toEqual({
        method: "aiSettings",
        args: [1],
      });
      await expect(callControl(path, "toString" as "projects")).rejects.toThrow(
        /Unknown command/,
      );
    } finally {
      server.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("closes malformed requests without breaking subsequent valid calls", async () => {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "relay-control-invalid-")),
  );
  const path = controlSocket(dir);
  const server = await serveControl(path, {
    projects: async () => [],
  } as unknown as ControlApi);
  try {
    for (const text of [
      "null",
      "[]",
      "42",
      "{}",
      '{"id":1,"method":null,"params":[]}',
      '{"id":1,"method":"projects","params":{}}',
      "{",
    ]) {
      await new Promise<void>((resolve, reject) => {
        const socket = createConnection(path);
        socket.once("connect", () => socket.write(text + "\n"));
        socket.once("error", reject);
        socket.once("close", () => resolve());
      });
      expect(await callControl(path, "projects")).toEqual([]);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

it("makes an existing public socket directory private even with a permissive umask", async () => {
  if (process.platform === "win32") return;
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "relay-control-mode-")),
  );
  await chmod(dir, 0o777);
  const mask = process.umask(0);
  let server: Awaited<ReturnType<typeof serveControl>> | undefined;
  try {
    const path = controlSocket(dir);
    server = await serveControl(path, {} as ControlApi);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(process.umask()).toBe(0);
  } finally {
    process.umask(mask);
    if (server)
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
