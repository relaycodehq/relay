import { expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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
