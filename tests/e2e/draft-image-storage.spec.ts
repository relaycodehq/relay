import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  test,
  expect,
  _electron as electron,
  type Page,
} from "../fixtures/electron";
import type { DraftImage } from "../../src/features/images/draft-images";

type StorageWindow = Window & {
  shots: typeof import("../../src/features/images/draft-images");
};
let source: string;
test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["src/features/images/draft-images.ts"],
    bundle: true,
    format: "iife",
    globalName: "shots",
    platform: "browser",
    write: false,
  });
  source = bundle.outputFiles[0].text;
});

/** Actual Chromium IndexedDB and production storage code, isolated from the app's own renderer. */
async function storage(work: (page: Page) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "relay-draft-image-storage-"));
  const app = await electron.launch({
    env: { ...process.env, RELAY_TEST_DATA: join(root, "data") },
  });
  try {
    await app.firstWindow();
    const created = app.waitForEvent("window");
    await app.evaluate(({ BrowserWindow }) => {
      const window = new BrowserWindow({
        show: false,
        webPreferences: { partition: "draft-image-storage" },
      });
      void window.loadURL("about:blank");
    });
    const page = await created;
    await page.route("http://draft-images.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Draft image storage</title>",
      }),
    );
    await page.goto("http://draft-images.test/");
    await work(page);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}

const original: DraftImage[] = [
  {
    id: "loose",
    name: "loose.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64," + "A".repeat(500_000),
  },
  {
    id: "undo",
    name: "ink.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,aW5r",
    n: 7,
    sketch: {
      width: 100,
      height: 50,
      strokes: [{ color: "#fff", points: [{ x: 1, y: 2 }], widths: [3] }],
    },
  },
];

async function seedV1(page: Page) {
  await page.evaluate(
    (images) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("relay-draft-images", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("drafts");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put(images, "chat-draft:kept");
          tx.objectStore("drafts").put([images[1]], "chat-draft:second");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    original,
  );
}

test("migrates screenshots intact and reads only metadata for counts and other windows", async () => {
  await storage(async (page) => {
    await seedV1(page);
    await page.addScriptTag({ content: source });
    const migrated = await page.evaluate(async () => {
      const shots = (window as unknown as StorageWindow).shots;
      const metadata = await shots.readDraftImageMetadata();
      return {
        metadata: metadata.get("chat-draft:kept"),
        count: shots.draftImageCount("chat-draft:kept"),
        images: await shots.loadDraftImages("chat-draft:kept"),
        second: {
          metadata: metadata.get("chat-draft:second"),
          images: await shots.loadDraftImages("chat-draft:second"),
        },
      };
    });
    expect(migrated).toEqual({
      metadata: { numbers: [undefined, 7], loose: 1 },
      count: 1,
      images: original,
      second: { metadata: { numbers: [7], loose: 0 }, images: [original[1]] },
    });

    // On every later start, reading all screenshots is a regression, not a
    // prerequisite of counts. Instrument the real object stores to enforce it.
    await page.reload();
    await page.evaluate(() => {
      const reads: string[] = [];
      Object.assign(window, { storageReads: reads });
      for (const name of [
        "get",
        "getAll",
        "getAllKeys",
        "openCursor",
      ] as const) {
        const method = IDBObjectStore.prototype[name];
        Object.assign(IDBObjectStore.prototype, {
          [name]: function (this: IDBObjectStore, ...args: unknown[]) {
            reads.push(`${this.name}:${name}`);
            if (this.name === "drafts" && name !== "getAllKeys")
              throw new Error("Startup read screenshot payloads");
            return Reflect.apply(method, this, args);
          },
        });
      }
    });
    await page.addScriptTag({ content: source });
    const snapshot = await page.evaluate(async () => {
      const shots = (window as unknown as StorageWindow).shots;
      const [first, second] = await Promise.all([
        shots.readDraftImageMetadata(),
        shots.readDraftImageMetadata(),
        shots.readDraftImageCounts(),
      ]);
      return {
        same: first === second,
        count: shots.draftImageCount("chat-draft:kept"),
        reads: (window as unknown as { storageReads: string[] }).storageReads,
      };
    });
    expect(snapshot).toEqual({
      same: true,
      count: 1,
      reads: ["metadata:getAllKeys", "metadata:getAll"],
    });

    const attached = page.waitForEvent("frameattached");
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = "/other-window";
      document.body.append(frame);
    });
    const other = await attached;
    await other.waitForURL("http://draft-images.test/other-window");
    await other.addScriptTag({ content: source });
    await other.evaluate(async () => {
      await (window as unknown as StorageWindow).shots.readDraftImageMetadata();
      for (const name of ["get", "getAll", "openCursor"] as const) {
        const method = IDBObjectStore.prototype[name];
        Object.assign(IDBObjectStore.prototype, {
          [name]: function (this: IDBObjectStore, ...args: unknown[]) {
            if (this.name === "drafts")
              throw new Error("Other window read screenshot payloads");
            return Reflect.apply(method, this, args);
          },
        });
      }
    });
    // Each save updates both stores and publishes metadata after commit.
    await page.evaluate(async () => {
      const shots = (window as unknown as StorageWindow).shots;
      await shots.saveDraftImages("chat-draft:new", [
        {
          id: "new",
          name: "new.png",
          mimeType: "image/png",
          dataUrl: "data:,",
        },
      ]);
    });
    await expect
      .poll(() =>
        other.evaluate(() =>
          (window as unknown as StorageWindow).shots.draftImageCount(
            "chat-draft:new",
          ),
        ),
      )
      .toBe(1);
    await page.evaluate(() =>
      (window as unknown as StorageWindow).shots.saveDraftImages(
        "chat-draft:new",
        [],
      ),
    );
    await expect
      .poll(() =>
        other.evaluate(() =>
          (window as unknown as StorageWindow).shots.draftImageCount(
            "chat-draft:new",
          ),
        ),
      )
      .toBe(0);
    expect(
      await other.evaluate(async () =>
        (
          await (
            window as unknown as StorageWindow
          ).shots.readDraftImageMetadata()
        ).has("chat-draft:new"),
      ),
    ).toBe(false);
    // Reopen a clean module, proving deletion reached both stores on disk.
    await page.reload();
    await page.addScriptTag({ content: source });
    expect(
      await page.evaluate(async () => {
        const shots = (window as unknown as StorageWindow).shots;
        return {
          images: await shots.loadDraftImages("chat-draft:new"),
          metadata: (await shots.readDraftImageMetadata()).has(
            "chat-draft:new",
          ),
        };
      }),
    ).toEqual({ images: [], metadata: false });
  });
});

test("rolls back failed metadata upgrades and saves without losing screenshots or sketches", async () => {
  await storage(async (page) => {
    await seedV1(page);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      Object.assign(window, {
        restorePut: () => {
          IDBObjectStore.prototype.put = put;
        },
      });
      IDBObjectStore.prototype.put = function (value, key) {
        const result = put.call(this, value, key);
        if (this.name === "metadata") this.transaction.abort();
        return result;
      };
    });
    await page.addScriptTag({ content: source });
    expect(
      await page.evaluate(async () => {
        try {
          await (
            window as unknown as StorageWindow
          ).shots.readDraftImageMetadata();
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    const rolledBack = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("relay-draft-images");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction("drafts");
            const get = tx.objectStore("drafts").get("chat-draft:kept");
            get.onsuccess = () => {
              resolve({
                version: db.version,
                stores: [...db.objectStoreNames],
                images: get.result,
              });
              db.close();
            };
          };
        }),
    );
    expect(rolledBack).toEqual({
      version: 1,
      stores: ["drafts"],
      images: original,
    });
    await page.evaluate(() =>
      (window as unknown as { restorePut(): void }).restorePut(),
    );
    expect(
      await page.evaluate(async () =>
        (
          await (
            window as unknown as StorageWindow
          ).shots.readDraftImageMetadata()
        ).get("chat-draft:kept"),
      ),
    ).toEqual({ numbers: [undefined, 7], loose: 1 });
    const failedSave = await page.evaluate(async () => {
      const shots = (window as unknown as StorageWindow).shots;
      let notifications = 0;
      shots.onDraftImagesSaved(() => notifications++);
      const put = IDBObjectStore.prototype.put;
      const remove = IDBObjectStore.prototype.delete;
      let failure = "throw";
      IDBObjectStore.prototype.put = function (value, key) {
        if (this.name === "metadata" && failure === "throw")
          throw new DOMException(
            "Injected metadata write failure",
            "QuotaExceededError",
          );
        const result = put.call(this, value, key);
        if (this.name === "metadata") this.transaction.abort();
        return result;
      };
      IDBObjectStore.prototype.delete = function (key) {
        const result = remove.call(this, key);
        if (this.name === "metadata") this.transaction.abort();
        return result;
      };
      let rejected = 0;
      for (failure of ["throw", "abort", "delete"]) {
        try {
          await shots.saveDraftImages(
            "chat-draft:kept",
            failure === "delete"
              ? []
              : [
                  {
                    id: "replacement",
                    name: "new.png",
                    mimeType: "image/png",
                    dataUrl: "data:,",
                    n: 2,
                  },
                ],
          );
        } catch {
          rejected++;
        }
      }
      IDBObjectStore.prototype.put = put;
      IDBObjectStore.prototype.delete = remove;
      return {
        rejected,
        notifications,
        images: await shots.loadDraftImages("chat-draft:kept"),
        metadata: (await shots.readDraftImageMetadata()).get("chat-draft:kept"),
      };
    });
    expect(failedSave).toEqual({
      rejected: 3,
      notifications: 0,
      images: original,
      metadata: { numbers: [undefined, 7], loose: 1 },
    });
    await page.reload();
    await page.addScriptTag({ content: source });
    expect(
      await page.evaluate(async () =>
        (
          await (
            window as unknown as StorageWindow
          ).shots.readDraftImageMetadata()
        ).get("chat-draft:kept"),
      ),
    ).toEqual({ numbers: [undefined, 7], loose: 1 });
  });
});
