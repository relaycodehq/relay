import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { CursorConnection } from "./connection";

it("cleans up after a worker that had already died when it was closed", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(1)"], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const cleanup = vi.fn(async () => {});
  const connection = new CursorConnection(child, cleanup);
  await once(child, "exit");
  connection.close();
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
});
