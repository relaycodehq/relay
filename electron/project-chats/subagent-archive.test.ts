import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SubagentDetail } from "../../shared/subagents";
import { SubagentArchive } from "./subagent-archive";

const failures = vi.hoisted(() => ({ write: false }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (failures.write) {
        failures.write = false;
        throw new Error("disk full");
      }
      return actual.writeFile(...args);
    },
  };
});
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-subagents-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));
const run = (id: string): SubagentDetail => ({
  id,
  description: id,
  status: "completed",
  started: 1,
  ended: 2,
  calls: 0,
  recent: [],
  trace: [],
});

it("retries identical runs after rename fails, without publishing unwritten runs", async () => {
  const archive = new SubagentArchive(dir);
  await mkdir(join(dir, "subagents", "chat.json"), { recursive: true });
  await expect(archive.keep("chat", [run("a")])).rejects.toThrow();
  expect(await archive.read("chat")).toEqual([]);
  expect(await readdir(join(dir, "subagents"))).toEqual(["chat.json"]);
  await rm(join(dir, "subagents", "chat.json"), { recursive: true });
  await archive.keep("chat", [run("a")]);
  expect(await new SubagentArchive(dir).read("chat")).toEqual([run("a")]);
});

it("lets a queued update retry after failure while retaining the durable baseline", async () => {
  const archive = new SubagentArchive(dir);
  await archive.keep("chat", [run("a")]);
  await rm(join(dir, "subagents", "chat.json"));
  await mkdir(join(dir, "subagents", "chat.json"));
  const first = archive.keep("chat", [run("b")]);
  const second = archive.keep("chat", [run("b")]);
  await expect(first).rejects.toThrow();
  await expect(second).rejects.toThrow();
  expect(await archive.read("chat")).toEqual([run("a")]);
  await rm(join(dir, "subagents", "chat.json"), { recursive: true });
  await archive.keep("chat", [run("b")]);
  expect(await new SubagentArchive(dir).read("chat")).toEqual([
    run("a"),
    run("b"),
  ]);
});

it("retains the durable baseline after a failed write and persists an identical retry", async () => {
  const archive = new SubagentArchive(dir);
  await archive.keep("chat", [run("a")]);
  failures.write = true;
  await expect(archive.keep("chat", [run("b")])).rejects.toThrow("disk full");
  expect(await archive.read("chat")).toEqual([run("a")]);
  expect(await new SubagentArchive(dir).read("chat")).toEqual([run("a")]);
  await archive.keep("chat", [run("b")]);
  expect(await new SubagentArchive(dir).read("chat")).toEqual([
    run("a"),
    run("b"),
  ]);
});
