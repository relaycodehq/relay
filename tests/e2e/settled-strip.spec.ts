import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

// An opened settled thread says so above the composer, and goes back to
// Activity by Unsettle or by the next message.
test.setTimeout(90_000);

test("an opened settled thread shows the settled strip until it's unsettled or answered", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-settled-")));
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  await mkdir(repo);
  await mkdir(bin);
  const agent = await readFile(
    resolve("tests/fixtures/slow-claude.cjs"),
    "utf8",
  );
  for (const name of ["codex", "claude"]) await fakeCli(join(bin, name), agent);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const start = Date.now() - 86_400_000;
  const chat = (title: string, settled: boolean, at: number) => ({
    id: randomUUID(),
    projectId,
    title,
    scope: { kind: "project" },
    created: at,
    updated: at + 1000,
    ...(settled ? { settledAt: at + 2000 } : {}),
    messages: [
      {
        id: `${title}-0`,
        role: "user",
        provider: "claude",
        status: "complete",
        body: "hello",
        created: at,
        version: 1,
      },
    ],
  });
  const chats = [chat("Wrapped up", true, start), chat("Other", false, start)];
  for (const c of chats)
    await writeFile(
      join(data, "project-chats", c.id + ".json"),
      JSON.stringify(c),
    );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      projects: [
        {
          id: projectId,
          path: repo,
          name: "project",
          repository: null,
          added: 1,
        },
      ],
      chats: chats.map((c) => ({ ...c, messages: undefined })),
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      SLOW_CLAUDE_MS: "20",
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    const strip = page.locator(".waiting-strip.settled");
    const settledRow = page.locator(".sb-compact", { hasText: "Wrapped up" });
    const activeCard = page.locator(".sb-card", { hasText: "Wrapped up" });
    const openFromShelf = async () => {
      const shelf = page.locator(".sb-shelf-toggle", { hasText: "Settled" });
      if ((await shelf.getAttribute("aria-expanded")) !== "true")
        await shelf.click();
      await settledRow.click();
      await expect(
        page.locator('[data-message-id="Wrapped up-0"]'),
      ).toBeVisible();
    };

    await openFromShelf();
    await expect(strip).toContainText("Settled");
    await expect(strip).toContainText("replying moves it back to Activity");
    await strip.getByRole("button", { name: "Unsettle" }).click();
    await expect(strip).toHaveCount(0);
    await expect(activeCard).toBeVisible();

    // Settle it from another thread, so settling doesn't move the selection.
    await page.locator(".sb-card", { hasText: "Other" }).click();
    await activeCard.hover();
    await activeCard.getByRole("button", { name: "Settle" }).click();
    await expect(activeCard).toHaveCount(0);
    // Nothing pops up to say so; ⌘Z takes it back for a few seconds.
    await expect(page.locator(".toast")).toHaveCount(0);
    await page.keyboard.press("Meta+z");
    await expect(activeCard).toBeVisible();
    await activeCard.hover();
    await activeCard.getByRole("button", { name: "Settle" }).click();
    await expect(activeCard).toHaveCount(0);
    await openFromShelf();
    await expect(strip).toBeVisible();

    const input = page.getByLabel("Message project");
    await input.fill("@claude One more thing");
    await input.press("Enter");
    await expect(strip).toHaveCount(0);
    await expect(
      page.locator(".project-messages [data-message-id]").last(),
    ).toContainText("twenty", { timeout: 30000 });
    await expect(strip).toHaveCount(0);
    await expect(activeCard).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
