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

it("keeps Gitea connected for saves where its switch only hid CI, once", async () => {
  await writeFile(
    join(dir, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      sourceControl: { off: ["github", "gitea"] },
    }),
  );
  const store = new Store(dir);
  await store.load();
  expect(store.get().sourceControl).toEqual({ off: ["github"], on: [] });
  // Turned off again after the change, it stays off.
  await store.update((s) => {
    s.sourceControl = { off: ["github", "gitea"], on: [] };
  });
  const reloaded = new Store(dir);
  await reloaded.load();
  expect(reloaded.get().sourceControl?.off).toEqual(["github", "gitea"]);
});
