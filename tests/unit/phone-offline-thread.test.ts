import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Load the native module at runtime so its Expo declarations stay out of the desktop test project.
const offlinePath = "../../mobile/src/remote/offline";

const disk = vi.hoisted(() => new Map<string, string>());
const filesystem = vi.hoisted(() => {
  class Directory {
    uri: string;
    constructor(parent: string | Directory, name: string) {
      this.uri = `${typeof parent === "string" ? parent : parent.uri}/${name}`;
    }
    get exists() {
      return [...disk.keys()].some((key) => key.startsWith(`${this.uri}/`));
    }
    create() {}
    delete() {
      for (const key of disk.keys())
        if (key.startsWith(`${this.uri}/`)) disk.delete(key);
    }
    list() {
      return [...disk.keys()]
        .filter((key) => key.startsWith(`${this.uri}/`))
        .map((key) => new File(this, key.slice(this.uri.length + 1)));
    }
  }
  class File {
    uri: string;
    name: string;
    constructor(
      public parentDirectory: Directory,
      name: string,
    ) {
      this.name = name;
      this.uri = `${parentDirectory.uri}/${name}`;
    }
    get exists() {
      return disk.has(this.uri);
    }
    write(value: string) {
      disk.set(this.uri, value);
    }
    delete() {
      disk.delete(this.uri);
    }
    textSync() {
      return disk.get(this.uri)!;
    }
    async text() {
      return disk.get(this.uri)!;
    }
  }
  return { Directory, File, Paths: { cache: "cache" } };
});
// Also mock the local package when Expo is installed; CI runs these without mobile deps.
vi.mock("expo-file-system", () => filesystem);
vi.mock("../../mobile/node_modules/expo-file-system", () => filesystem);

const thread = (title: string) => ({ id: "t1", title, messages: [] });

beforeEach(() => {
  disk.clear();
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("reads a thread saved on an earlier visit before the screen's first frame", async () => {
  const offline = await import(offlinePath);
  offline.setOfflineComputer("mac");
  disk.set("cache/relay-offline/mac/thread-t1.json", JSON.stringify(thread("On disk")));
  expect(offline.threadNow("t1")).toMatchObject({ title: "On disk" });
  expect(offline.threadNow("t2")).toBeUndefined();
});

it("opens a thread again on its latest copy while the write still waits", async () => {
  const offline = await import(offlinePath);
  offline.setOfflineComputer("mac");
  offline.saveThread("t1", thread("First"));
  vi.advanceTimersByTime(5_000);
  offline.saveThread("t1", thread("Second"));
  expect(JSON.parse(disk.get("cache/relay-offline/mac/thread-t1.json")!).title).toBe("First");
  expect(offline.threadNow("t1")).toMatchObject({ title: "Second" });
  await expect(offline.loadThread("t1")).resolves.toMatchObject({ title: "Second" });
});

it("keeps each computer's threads apart and forgets them on unpairing", async () => {
  const offline = await import(offlinePath);
  offline.setOfflineComputer("mac");
  offline.saveThread("t1", thread("Mac's"));
  offline.setOfflineComputer("mini");
  expect(offline.threadNow("t1")).toBeUndefined();
  offline.setOfflineComputer("mac");
  offline.forgetOffline("mac");
  expect(offline.threadNow("t1")).toBeUndefined();
});
