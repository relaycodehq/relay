import { test, expect, _electron as electron } from "../fixtures/electron";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

test("thread windows follow preferences, keep their zoom, and preserve a 13 px prompt on reload", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-window-prefs-")),
  );
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID(),
    now = Date.now();
  const threads = ["Popped thread", "Main thread"].map((title, i) => ({
    id: randomUUID(),
    projectId,
    title,
    scope: { kind: "project" },
    created: now - 60_000,
    updated: now - i * 1000,
    provider: "codex",
    messages: [
      {
        id: randomUUID(),
        role: "user",
        provider: "codex",
        status: "complete",
        body: title,
        created: now - 30_000,
        version: 1,
      },
      {
        id: randomUUID(),
        role: "assistant",
        provider: "codex",
        status: "complete",
        body: `Answer in ${title}`,
        created: now - 20_000,
        ended: now - 20_000,
        version: 1,
      },
    ],
  }));
  for (const thread of threads)
    await writeFile(
      join(data, "project-chats", `${thread.id}.json`),
      JSON.stringify(thread),
    );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      sidebarView: "activity",
      projects: [
        {
          id: projectId,
          path: repo,
          name: "project",
          repository: null,
          added: 1,
        },
      ],
      chats: threads.map(({ messages: _messages, ...thread }) => thread),
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        key !== "ELECTRON_RUN_AS_NODE" &&
        key !== "RELAY_DEV_URL" &&
        value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    env: {
      ...env,
      RELAY_TEST_DATA: data,
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Open settings", exact: true }),
    ).toBeVisible();
    // Notes exercise the real send key without starting a provider.
    await page.evaluate(
      (ids) => {
        for (const id of ids)
          localStorage.setItem(
            `composer-settings:${id}`,
            JSON.stringify({ agent: "message" }),
          );
      },
      threads.map((t) => t.id),
    );
    await page.locator(".sb-card", { hasText: "Popped thread" }).click();
    const settings = page.getByRole("region", {
      name: "Settings",
      exact: true,
    });
    const openAppearance = async () => {
      await page
        .getByRole("button", { name: "Open settings", exact: true })
        .click();
      await settings
        .getByRole("navigation", { name: "Settings categories" })
        .getByRole("button", { name: "Appearance", exact: true })
        .click();
    };
    const chooseSize = async (name: string, size: number) => {
      await settings.getByRole("combobox", { name, exact: true }).click();
      await page
        .getByRole("option", { name: `${size} px`, exact: true })
        .click();
    };
    await openAppearance();
    await settings.getByRole("switch", { name: "Advanced typography" }).check();
    await chooseSize("Interface font size", 16);
    await chooseSize("Prompt font size", 13);
    await page.reload();
    await openAppearance();
    await expect(
      settings.getByRole("combobox", { name: "Prompt font size", exact: true }),
    ).toHaveText("13 px");
    await settings.getByRole("button", { name: "Back to app" }).click();

    const opened = app.waitForEvent("window");
    await page
      .getByRole("button", { name: "Open in new window", exact: true })
      .click();
    const own = await opened;
    const composer = own.getByLabel("Message project");
    await expect(composer).toBeVisible();
    const mainWindow = await app.browserWindow(page);
    const ownWindow = await app.browserWindow(own);
    const zoom = () =>
      ownWindow.evaluate((win) => win.webContents.getZoomFactor());
    await expect.poll(zoom).toBeCloseTo(16 / 13);
    // A manual zoom belongs to this window, on top of its chosen interface size.
    await ownWindow.evaluate((win) =>
      win.webContents.setZoomFactor((16 / 13) * 1.5),
    );
    await page.locator(".sb-card", { hasText: "Main thread" }).click();
    await openAppearance();
    await chooseSize("Interface font size", 11);
    await expect.poll(zoom).toBeCloseTo((11 / 13) * 1.5);
    await expect
      .poll(() => mainWindow.evaluate((win) => win.webContents.getZoomFactor()))
      .toBeCloseTo(11 / 13);
    await expect
      .poll(() =>
        own.evaluate(() =>
          document.documentElement.style.getPropertyValue("--prompt-font-size"),
        ),
      )
      .toBe("15.364px");

    if (!process.env.CI) {
      await settings
        .getByRole("combobox", { name: "Prompt font size", exact: true })
        .scrollIntoViewIfNeeded();
      const screenshot = await mainWindow.evaluate(async (win) =>
        (await win.webContents.capturePage()).toPNG().toString("base64"),
      );
      await writeFile(
        join(tmpdir(), "relay-fixed-window-preferences.png"),
        Buffer.from(screenshot, "base64"),
      );
    }

    await settings
      .getByRole("navigation", { name: "Settings categories" })
      .getByRole("button", { name: "Composer", exact: true })
      .click();
    await settings
      .getByRole("region", { name: "Send messages with", exact: true })
      .getByRole("button", { name: "Shift Enter", exact: true })
      .click();
    await settings.getByRole("button", { name: "Back to app" }).click();
    const note = "Keep this as a draft until Shift Enter";
    await expect(
      own.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText("Message only");
    await composer.fill(note);
    await composer.press("Enter");
    await expect(composer).toContainText(note);
    expect(
      await own.evaluate(
        async (id) =>
          (await window.relay.projectChat(id)).messages.filter(
            (m) =>
              typeof m !== "string" &&
              m.body === "Keep this as a draft until Shift Enter",
          ).length,
        threads[0].id,
      ),
    ).toBe(0);
    await composer.press("Shift+Enter");
    await expect
      .poll(() =>
        own.evaluate(
          async (id) =>
            (await window.relay.projectChat(id)).messages.filter(
              (m) =>
                typeof m !== "string" &&
                m.body === "Keep this as a draft until Shift Enter",
            ).length,
          threads[0].id,
        ),
      )
      .toBe(1);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
