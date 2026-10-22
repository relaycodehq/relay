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
