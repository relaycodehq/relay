import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Store } from "./store";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-store-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it("loads a save from before pull request rooms were removed and drops what they kept", async () => {
  await writeFile(
    join(dir, "state.json"),
    JSON.stringify({
      version: 1,
      folders: { a: "/code/a" },
      progress: {},
      roomAccessConsents: { x: true },
      roomHosting: "sealed",
      roomConnections: { x: "sealed" },
      roomJoins: { x: "y" },
      roomDeliveries: { x: { key: "x" } },
    }),
  );
  const store = new Store(dir);
  await store.load();
  expect(store.get().folders).toEqual({ a: "/code/a" });
  await store.update((s) => {
    s.keepAwake = false;
  });
  const saved = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  expect(Object.keys(saved).filter((k) => k.startsWith("room"))).toEqual([]);
});
