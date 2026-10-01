import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

test("drops what's kept for threads that are gone, after the thread lists load", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-sweep-")));
  const repo = join(root, "alpha");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, "README.md"), "Example");
  git("add", ".");
  git("commit", "-qm", "Initial");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, repo);
    const { seeded, kept } = await page.evaluate(async () => {
      const project = (await window.relay.addProject())!;
      const live = await window.relay.createProjectChat(project.id, {
        kind: "project",
      });
      const keys = (id: string) => [
        "chat-draft:" + id,
        "chat-reply:" + id,
        "composer-settings:" + id,
        "skill-chips:chat-draft:" + id,
      ];
      // An unsent slot left empty, and a thread that's gone.
      const seeded = [
        ...keys(live.id),
        ...keys("gone"),
        `composer-settings:new:${project.id}:left`,
      ];
      for (const key of seeded)
        localStorage.setItem(key, key.startsWith("chat-draft:") ? "Hi" : "{}");
      // A screenshot pasted into the gone thread's draft.
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("relay-draft-images", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("drafts");
        open.onsuccess = () => {
          const tx = open.result.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put([{ id: "x" }], "chat-draft:gone");
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      return { seeded, kept: keys(live.id) };
    });
    await page.reload();
    const left = () =>
      page.evaluate(
        (keys) => keys.filter((key) => localStorage.getItem(key) !== null),
        seeded,
      );
    await expect.poll(left, { timeout: 20000 }).toEqual(kept);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              const open = indexedDB.open("relay-draft-images", 1);
              open.onsuccess = () => {
                const keys = open.result
                  .transaction("drafts")
                  .objectStore("drafts")
                  .getAllKeys();
                keys.onsuccess = () => {
                  open.result.close();
                  resolve(keys.result);
                };
              };
            }),
        ),
      )
      .toEqual([]);
  } finally {
    await app.close();
  }
});
