import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { Store } from "../app/store";
import { SavedPreviews, type SavedPreview } from "./saved-previews";

it("keeps thread previews across disk reloads, isolated by project and thread", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-saved-previews-"));
  try {
    const store = new Store(dir);
    await store.load();
    const saved = new SavedPreviews(store);
    const value: SavedPreview = {
      projectId: "project",
      folder: "/repo/worktree",
      url: "http://localhost:5173/previews/example/?mode=two#details",
      dev: { port: 5173, command: "npm run dev -- --port 5173" },
      settings: {},
    };
    await saved.set("one", value);
    await saved.set("two", {
      ...value,
      url: "https://example.com/",
      dev: undefined,
    });
    await store.flush();
    const nextStore = new Store(dir);
    await nextStore.load();
    const next = new SavedPreviews(nextStore);
    expect(next.get("project", "one")).toEqual(value);
    expect(next.get("project", "two")?.url).toBe("https://example.com/");
    expect(next.get("other-project", "one")).toBeUndefined();
    expect(next.get("project", "missing")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("forgets a deleted thread's page whose save was still being written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-saved-previews-"));
  try {
    const store = new Store(dir);
    await store.load();
    const saved = new SavedPreviews(store);
    const page: SavedPreview = {
      projectId: "project",
      folder: "/repo",
      url: "http://localhost:3000/",
      settings: {},
    };
    await saved.set("kept", page);
    const writing = saved.set("thread~p1", page);
    await saved.forgetThread("thread");
    await writing;
    expect(Object.keys(store.get().previews ?? {})).toEqual(["kept"]);
    expect(saved.get("project", "thread~p1")).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
