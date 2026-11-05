import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "./store";
import { writeFileAtomic } from "../util/atomic-write";

vi.mock("../util/atomic-write", async (real) => {
  const actual = await real<typeof import("../util/atomic-write")>();
  return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) };
});

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "relay-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Store", () => {
  it("has nothing left to save after a change refused before writing", async () => {
    const store = new Store(dir);
    await store.load();
    await store.update((s) => {
      s.gitPath = "/usr/bin/git";
    });

    await expect(
      store.update(() => {
        throw new Error("That folder is no longer linked to this thread.");
      }),
    ).rejects.toThrow("no longer linked");

    await expect(store.flush()).resolves.toBeUndefined();
    const saved = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
    expect(saved.gitPath).toBe("/usr/bin/git");
  });

  it.skipIf(process.platform === "win32")(
    "still reports a change that couldn't be written",
    async () => {
      const store = new Store(dir);
      await store.load();
      await chmod(dir, 0o500);
      try {
        await expect(
          store.update((s) => {
            s.gitPath = "/usr/bin/git";
          }),
        ).rejects.toThrow();
        await expect(store.flush()).rejects.toThrow();
      } finally {
        await chmod(dir, 0o700);
      }
    },
  );

  describe("changes written soon", () => {
    const writes = () => readFile(join(dir, "state.json"), "utf8");

    it("gathers a burst into one write, a moment later", async () => {
      const store = new Store(dir);
      await store.load();
      vi.useFakeTimers();
      try {
        for (const title of ["one", "two", "three"])
          await store.updateSoon((s) => {
            s.projectsFolder = title;
          });
        expect(store.get().projectsFolder).toBe("three");
        await expect(writes()).rejects.toThrow();

        await vi.advanceTimersByTimeAsync(1000);
        await store.flush();
      } finally {
        vi.useRealTimers();
      }
      expect(JSON.parse(await writes()).projectsFolder).toBe("three");
    });

    it("writes them at once on flush, as Relay quits", async () => {
      const store = new Store(dir);
      await store.load();
      await store.updateSoon((s) => {
        s.projectsFolder = "/code";
      });

      await store.flush();

      expect(JSON.parse(await writes()).projectsFolder).toBe("/code");
    });

    it("writes on flush one still queued behind a write under way", async () => {
      const store = new Store(dir);
      await store.load();
      const writing = store.update((s) => {
        s.gitPath = "/usr/bin/git";
      });
      void store.updateSoon((s) => {
        s.projectsFolder = "/code";
      });

      await store.flush();

      expect(JSON.parse(await writes()).projectsFolder).toBe("/code");
      await writing;
    });

    it("lets a change written now carry them along", async () => {
      const store = new Store(dir);
      await store.load();
      await store.updateSoon((s) => {
        s.projectsFolder = "/code";
      });

      await store.update((s) => {
        s.gitPath = "/usr/bin/git";
      });

      const saved = JSON.parse(await writes());
      expect(saved).toMatchObject({
        projectsFolder: "/code",
        gitPath: "/usr/bin/git",
      });
    });
  });

  describe("after a power cut empties state.json", () => {
    /** A launch that quit, flushing what it wrote. */
    const launch = async () => {
      const store = new Store(dir);
      await store.load();
      await store.flush();
      return store;
    };

    it("keeps the copy without making the launch wait for the disk", async () => {
      await (await launch()).update((s) => {
        s.gitPath = "/usr/bin/git";
      });
      let written = () => {};
      vi.mocked(writeFileAtomic).mockImplementationOnce(
        () => new Promise<void>((resolve) => (written = resolve)),
      );

      const store = new Store(dir);
      // Resolves while the copy is still being written.
      await store.load();
      let flushed = false;
      const flush = store.flush().then(() => (flushed = true));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(flushed).toBe(false);
      written();
      await flush;
    });

    it("starts from the copy kept at the last good launch", async () => {
      const first = await launch();
      await first.update((s) => {
        s.gitPath = "/usr/bin/git";
      });
      await launch(); // keeps the copy
      await writeFile(join(dir, "state.json"), "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const recovered = await launch();

      expect(recovered.get().gitPath).toBe("/usr/bin/git");
      expect(recovered.savedAtLoad).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("starting from state.json.bak"),
      );
      warn.mockRestore();
    });

    it("keeps the copy that loaded, not a later damaged state.json", async () => {
      const first = await launch();
      await first.update((s) => {
        s.gitPath = "/usr/bin/git";
      });
      await launch();
      await writeFile(join(dir, "state.json"), '{"version":1,"fol');
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await launch();
      await launch();
      vi.restoreAllMocks();

      const kept = JSON.parse(
        await readFile(join(dir, "state.json.bak"), "utf8"),
      );
      expect(kept.gitPath).toBe("/usr/bin/git");
    });

    it("refuses to start without a readable copy, and touches neither file", async () => {
      await writeFile(join(dir, "state.json"), "");
      await writeFile(join(dir, "state.json.bak"), '{"vers');

      await expect(launch()).rejects.toThrow("no readable earlier copy");
      expect(await readFile(join(dir, "state.json"), "utf8")).toBe("");
      expect(await readFile(join(dir, "state.json.bak"), "utf8")).toBe(
        '{"vers',
      );
    });
  });
});
