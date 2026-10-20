import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { writeStoredCodexSession } from "../fixtures/codex-store";
import { screenshot } from "../fixtures/screenshot";

test("imports selected projects and chats from the Add project menu, reusing projects and locating missing folders", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-import-projects-")),
  );
  const repo = join(root, "onboarding"),
    web = join(root, "web-libs"),
    gone = join(root, "gone-project"),
    recovered = join(root, "recovered"),
    home = join(root, "codex"),
    bin = join(root, "bin");
  for (const path of [repo, web, recovered, bin]) await mkdir(path);
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["claude", "codex"]) await fakeCli(join(bin, name), agent);
  const { path: history } = await writeStoredCodexSession(
    home,
    repo,
    "release-chat-01",
    [{ prompt: "Inspect the release script", answer: "It signs the build." }],
    { name: "Inspect release script" },
  );
  await writeStoredCodexSession(
    home,
    repo,
    "theme-chat-01",
    [{ prompt: "Change the theme", answer: "Theme changed." }],
    { name: "Add draggable theme transition" },
  );
  await writeStoredCodexSession(
    home,
    web,
    "website-chat-01",
    [{ prompt: "Build the site", answer: "Site built." }],
    { name: "Build website" },
  );
  await writeStoredCodexSession(
    home,
    gone,
    "deleted-chat-01",
    [{ prompt: "Review the project", answer: "Review complete." }],
    { name: "Review deleted work" },
  );
  await writeStoredCodexSession(home, repo, "missing-history-01", []);
  const before = await readFile(history);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
      CODEX_HOME: home,
      CLAUDE_CONFIG_DIR: join(root, "claude"),
    },
  });
  try {
    const page = await app.firstWindow();
    // Start with a project already added and deliberately renamed by the user.
    const existing = await page.evaluate(async (folder) => {
      const project = await window.relay.addProjectAt(folder);
      await window.relay.renameProject(project.id, "My Onboarding");
      return project.id;
    }, repo);
    await page.reload();
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Add a project", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "This computer", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: join(tmpdir(), "relay-sidebar-add-project-dialog.png"),
    });
    const entry = page.getByRole("button", {
      name: "Import from another app…",
      exact: true,
    });
    await expect(entry).toBeVisible();
    await screenshot(page, {
      path: join(tmpdir(), "relay-project-import-menu.png"),
    });
    await entry.click();
    const dialog = page.getByRole("dialog", {
      name: "Add a project",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", {
        name: "Import from another app",
        exact: true,
      }),
    ).toBeVisible();
    await screenshot(dialog, {
      path: join(tmpdir(), "relay-project-import-apps.png"),
    });
    await dialog.getByRole("button", { name: /Codex \/ ChatGPT/ }).click();
    await page.keyboard.press("Escape");
    await expect(
      dialog.getByRole("heading", {
        name: "Import from another app",
        exact: true,
      }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /Codex \/ ChatGPT/ }).click();
    const onboarding = dialog.getByRole("checkbox", {
      name: "Import onboarding",
      exact: true,
    });
    await onboarding.check();
    await expect(
      dialog.getByRole("checkbox", {
        name: "Import chat Inspect release script",
        exact: true,
      }),
    ).toBeChecked();
    await dialog
      .getByRole("checkbox", {
        name: "Import chat Add draggable theme transition",
        exact: true,
      })
      .uncheck();
    await dialog
      .getByRole("checkbox", { name: "Import web-libs", exact: true })
      .check();
    const missing = dialog.getByRole("checkbox", {
      name: "Import gone-project",
      exact: true,
    });
    await expect(missing).toBeDisabled();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, recovered);
    await dialog
      .getByRole("button", { name: "Locate folder…", exact: true })
      .click();
    await expect(missing).toBeChecked();
    const submit = dialog.getByRole("button", {
      name: "Import 3 projects and 3 chats",
      exact: true,
    });
    await expect(submit).toBeEnabled();
    await screenshot(page, {
      path: join(tmpdir(), "relay-project-import-selection.png"),
    });
    await screenshot(dialog, {
      path: join(tmpdir(), "relay-project-import-dialog.png"),
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await screenshot(dialog, {
      path: join(tmpdir(), "relay-project-import-dialog-dark.png"),
    });
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "light" });
    await submit.click();
    await expect(
      dialog.getByText("Import complete", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("status").filter({ hasText: "Import complete" }),
    ).toContainText("3 chats were imported");
    await screenshot(page, {
      path: join(tmpdir(), "relay-project-import-complete.png"),
    });
    const imported = await page.evaluate(async () => {
      const projects = await window.relay.projects();
      return Promise.all(
        projects
          .filter((p) => !p.scratch)
          .map(async (p) => ({
            id: p.id,
            name: p.name,
            path: p.path,
            chats: (await window.relay.projectChats(p.id)).map((c) => ({
              title: c.title,
              from: c.fromTerminal,
            })),
          })),
      );
    });
    expect(imported).toHaveLength(3);
    expect(imported.find((p) => p.id === existing)).toMatchObject({
      name: "My Onboarding",
      chats: [{ title: "Inspect release script" }],
    });
    expect(imported.find((p) => p.path === web)?.chats).toHaveLength(1);
    expect(imported.find((p) => p.path === recovered)?.chats).toHaveLength(1);
    expect(await readFile(history)).toEqual(before);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import from another app…", exact: true })
      .click();
    await dialog.getByRole("button", { name: /Codex \/ ChatGPT/ }).click();
    await dialog
      .getByRole("checkbox", { name: "Import onboarding", exact: true })
      .check();
    await expect(
      dialog.getByRole("checkbox", {
        name: "Import chat Inspect release script",
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole("checkbox", {
        name: "Import chat Add draggable theme transition",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", {
        name: "Import 1 project and 1 chat",
        exact: true,
      }),
    ).toBeEnabled();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
