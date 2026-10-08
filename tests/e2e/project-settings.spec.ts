import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { screenshot } from "../fixtures/screenshot";

// A project's own settings page, opened from its menu: where its new threads
// start, and settling a thread whose agent committed once it stays quiet.
test.setTimeout(90_000);

test("a project's settings change where its threads start and settle them after a commit", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-psettings-")),
  );
  const data = join(root, "data");
  await mkdir(join(data, "project-chats"), { recursive: true });
  const project = (name: string) => {
    const path = join(root, name);
    execFileSync("git", ["init", "-q", "-b", "main", path]);
    return { id: randomUUID(), path, name, repository: null, added: 1 };
  };
  const other = project("other");
  const relayApp = project("relay-app");
  const now = Date.now();
  const committedAt = now - 20 * 60_000;
  const thread = {
    id: randomUUID(),
    projectId: relayApp.id,
    title: "Ship the cache fix",
    scope: { kind: "project" },
    created: committedAt - 60_000,
    updated: committedAt,
    committedAt,
    messages: [
      {
        id: "u1",
        role: "user",
        provider: "claude",
        status: "complete",
        body: "@claude Fix it and commit",
        created: committedAt - 60_000,
        version: 1,
      },
      {
        id: "a1",
        role: "assistant",
        provider: "claude",
        status: "complete",
        body: "Fixed and committed.",
        created: committedAt - 50_000,
        ended: committedAt,
        version: 1,
      },
    ],
  };
  await writeFile(
    join(data, "project-chats", thread.id + ".json"),
    JSON.stringify(thread),
  );
  const { messages: _, ...summary } = thread;
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      sidebarView: "threads",
      projects: [other, relayApp],
      chats: [{ ...summary, provider: "claude" }],
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
    const settled = () =>
      page.evaluate(
        async (id) =>
          (await window.relay.projectChats(id)).find((c) => c.settledAt)
            ?.autoSettled ?? false,
        relayApp.id,
      );
    // Twenty quiet minutes after a commit, but the app doesn't settle on one.
    expect(await settled()).toBe(false);

    await expect(
      page.getByRole("button", { name: "Project actions for Relay App" }),
    ).toBeVisible();

    // Global settings stays global, even with projects available.
    const openSettings = () =>
      page.keyboard.press(
        process.platform === "darwin" ? "Meta+Comma" : "Control+Comma",
      );
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    const categories = settings.getByRole("navigation", {
      name: "Settings categories",
    });
    await openSettings();
    await expect(settings).toBeVisible();
    await expect(
      categories.getByRole("button", { name: /^Projects?$/ }),
    ).toHaveCount(0);
    await expect(
      categories.getByRole("button", { name: "Project settings" }),
    ).toHaveCount(0);
    const search = settings.getByRole("textbox", { name: "Search settings" });
    await search.fill("worktree");
    await expect(
      settings.locator('.settings-result[aria-label$="in Project settings"]'),
    ).toHaveCount(0);
    await screenshot(page, {
      path: "test-results/screenshots/global-settings-no-projects.png",
    });
    await settings.getByRole("button", { name: "Back to app" }).click();

    await page
      .getByRole("button", { name: "Project actions for Relay App" })
      .click();
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    await expect(
      settings.getByRole("heading", { name: "Relay App settings" }),
    ).toBeVisible();
    await expect(
      settings.getByRole("textbox", { name: "Project name" }),
    ).toHaveValue("Relay App");
    await expect(
      settings.getByRole("combobox", { name: "Project", exact: true }),
    ).toHaveCount(0);
    await search.fill("");
    await expect(
      settings.getByRole("combobox", { name: "Settle quiet threads" }),
    ).toHaveText(/Like the app \(after 3 days\)/);

    await settings
      .getByRole("combobox", { name: "Where new threads start" })
      .click();
    await page.getByRole("option", { name: /New worktree/ }).click();
    await settings
      .getByRole("switch", { name: "Settle threads after the agent commits" })
      .check();
    await expect.poll(settled).toBe(true);
    await screenshot(page, {
      path: "test-results/screenshots/project-settings.png",
    });
    const saved = await page.evaluate(
      async (id) =>
        (await window.relay.projects()).find((p) => p.id === id)?.settings,
      relayApp.id,
    );
    expect(saved).toEqual({ workspace: "worktree", settleOnCommit: true });

    // Reopening general settings must drop the project context.
    await settings.getByRole("button", { name: "Back to app" }).click();
    await openSettings();
    await expect(
      settings.getByRole("heading", { name: "Appearance", exact: true }),
    ).toBeVisible();
    await expect(
      categories.getByRole("button", { name: "Project settings" }),
    ).toHaveCount(0);
    await settings.getByRole("button", { name: "Back to app" }).click();

    // The other project is reached through its own existing entry point.
    await page
      .getByRole("button", { name: "Project actions for Other" })
      .click();
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    await expect(
      settings.getByRole("heading", { name: "Other settings" }),
    ).toBeVisible();
    await expect(
      settings.getByRole("combobox", { name: "Project", exact: true }),
    ).toHaveCount(0);
    await expect(
      settings.getByRole("switch", {
        name: "Settle threads after the agent commits",
      }),
    ).not.toBeChecked();

    await page.getByRole("button", { name: "Back to app" }).click();
    await page.getByRole("button", { name: "New thread in Relay App" }).click();
    await expect(page.locator(".workspace-trigger").first()).toHaveText(
      /New worktree/,
    );
    await page.getByRole("button", { name: "New thread in Other" }).click();
    await expect(page.locator(".workspace-trigger").first()).toHaveText(
      /Project folder/,
    );
  } finally {
    await app.close();
  }
});
