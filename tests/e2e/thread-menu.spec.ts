import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { screenshot } from "../fixtures/screenshot";

// A thread's right-click menu: Fork from its latest answer on that answer's
// agent, rename in place, mark unread; and a quiet thread settling by itself.
test.setTimeout(90_000);

test("a thread's right-click menu forks, renames and marks unread; quiet threads settle", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-tmenu-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const now = Date.now();
  const message = (
    id: string,
    role: "user" | "assistant",
    provider: "codex" | "claude",
    body: string,
    at: number,
  ) => ({
    id,
    role,
    provider,
    status: "complete",
    body,
    created: at,
    ...(role === "assistant" ? { ended: at } : {}),
    version: 1,
  });
  const thread = (
    title: string,
    at: number,
    messages: ReturnType<typeof message>[],
  ) => ({
    id: randomUUID(),
    projectId,
    title,
    scope: { kind: "project" },
    created: at - 60_000,
    updated: at,
    messages,
  });
  const busy = thread("Cache guard work", now - 60_000, [
    message("u1", "user", "codex", "@codex Explain the cache", now - 90_000),
    message("a1", "assistant", "codex", "Codex explains", now - 80_000),
    message("u2", "user", "claude", "@claude Now fix it", now - 70_000),
    message("a2", "assistant", "claude", "Claude fixed it", now - 60_000),
  ]);
  const other = thread("Something else", now - 30_000, [
    message("o1", "user", "codex", "@codex Hi", now - 40_000),
    message("o2", "assistant", "codex", "Hello", now - 30_000),
  ]);
  const quiet = thread("Old and quiet", now - 5 * 86_400_000, [
    message("q1", "user", "codex", "@codex Old", now - 5 * 86_400_000),
  ]);
  const chats = [busy, other, quiet];
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
      // As Relay saves them: the latest answer's agent, no messages.
      chats: chats.map(({ messages, ...c }) => ({
        ...c,
        provider: [...messages].reverse().find((m) => m.role === "assistant")
          ?.provider,
      })),
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
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate((id) => {
      localStorage.setItem("relay-sidebar-view", "activity");
      // The thread's composer went back to Codex; the fork follows the answer.
      localStorage.setItem(
        `composer-settings:${id}`,
        JSON.stringify({ agent: "codex" }),
      );
    }, busy.id);
    await page.reload();

    // Five days quiet: settled by itself, not an active card.
    await expect(
      page.locator(".sb-card", { hasText: "Old and quiet" }),
    ).toHaveCount(0);
    await page.locator(".sb-shelf-toggle", { hasText: "Settled" }).click();
    await expect(
      page.locator(".sb-compact", { hasText: "Old and quiet" }),
    ).toBeVisible();

    const cardTitled = (title: string) =>
      page.locator(".sb-card").filter({
        has: page.locator(".sb-card-title", {
          hasText: new RegExp(`^${title}$`),
        }),
      });
    const card = cardTitled("Cache guard work");
    await card.click({ button: "right" });
    const menu = page.locator(".sb-menu");
    await expect(
      menu.getByRole("menuitem", { name: /Fork from last answer/ }),
    ).toContainText("Claude");
    await screenshot(page, {
      path: "test-results/screenshots/thread-menu.png",
    });

    await menu.getByRole("menuitem", { name: /Fork from last answer/ }).click();
    const fork = page.locator(".sb-card", {
      hasText: "Fork: Cache guard work",
    });
    await expect(fork).toHaveClass(/selected/);
    await expect(
      page.locator("[data-message-id]").filter({ hasText: "Claude fixed it" }),
    ).toBeVisible();
    const forkAgent = await page.evaluate(
      () =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith("composer-settings:"))
          .map((k) => JSON.parse(localStorage.getItem(k)!))
          .filter((s) => s.agent === "claude").length,
    );
    expect(forkAgent).toBe(1);

    await card.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Rename thread" }).click();
    const name = page.getByLabel("Thread name");
    await name.fill("Cache guard, renamed");
    await name.press("Enter");
    await expect(
      page.locator(".sb-card", { hasText: "Cache guard, renamed" }),
    ).toBeVisible();

    const otherCard = page.locator(".sb-card", { hasText: "Something else" });
    await expect(otherCard).not.toHaveClass(/unread/);
    await otherCard.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Mark unread" }).click();
    await expect(otherCard).toHaveClass(/unread/);
    await otherCard.click();
    await page.locator(".sb-card", { hasText: "Cache guard, renamed" }).click();
    await expect(otherCard).not.toHaveClass(/unread/);

    // Settings is a page now: a week leaves a five-day-old thread active.
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .click();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await settings
      .getByRole("combobox", { name: "Auto-settle quiet threads", exact: true })
      .click();
    await page
      .getByRole("option", { name: "After a week", exact: true })
      .click();
    await expect(
      settings.getByRole("combobox", {
        name: "Auto-settle quiet threads",
        exact: true,
      }),
    ).toHaveText("After a week");
    await screenshot(page, {
      path: "test-results/screenshots/auto-settle-setting.png",
    });
    await expect
      .poll(() => page.evaluate(() => window.relay.autoSettleDays()))
      .toBe(7);
    await page.getByRole("button", { name: "Back to app" }).click();
    await expect(
      page.locator(".sb-card", { hasText: "Old and quiet" }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
