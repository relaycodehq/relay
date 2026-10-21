import { test, expect, _electron as electron } from "../fixtures/electron";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "@playwright/test";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { writeStoredCodexSession } from "../fixtures/codex-store";
import { screenshot } from "../fixtures/screenshot";

/** Has the thread's agent call one of Relay's tools; resolves to what it answered. */
async function callTool(page: Page, tool: string, input: unknown) {
  const answers = page.getByRole("article", { name: /answer$/ });
  const before = await answers.count();
  await page
    .getByRole("textbox", { name: /^Message/ })
    .fill(`fixture relay ${tool} ${JSON.stringify(input)}`);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(answers).toHaveCount(before + 1);
  await expect(
    page.getByRole("button", { name: "Stop answer", exact: true }),
  ).toHaveCount(0);
  return (await answers.last().locator(".markdown").first().innerText()).trim();
}

test("an agent offers a Codex history to import, the user regroups and imports it", async () => {
  test.setTimeout(120000);
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-agent-import-")),
  );
  const home = join(root, "codex"),
    bin = join(root, "bin");
  const history: Record<string, string[]> = {
    backend: ["Add account endpoints", "Fix webhook retries"],
    website: ["Build the product page", "Polish checkout"],
    game: ["Prototype the movement"],
  };
  for (const name of Object.keys(history)) await mkdir(join(root, name));
  await mkdir(bin);
  const agent = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  for (const name of ["claude", "codex"]) await fakeCli(join(bin, name), agent);
  for (const [name, titles] of Object.entries(history))
    for (const [i, title] of titles.entries())
      await writeStoredCodexSession(
        home,
        join(root, name),
        `${name}-${i}`,
        [{ prompt: title, answer: `Done: ${title}.` }],
        { name: title, ago: (i + 1) * 86_400_000 },
      );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      CODEX_HOME: home,
      CLAUDE_CONFIG_DIR: join(root, "claude"),
    },
  });
  try {
    const page = await app.firstWindow();
    // Backend is already a project, in a group of its own.
    const backend = await page.evaluate(
      async (folder) => {
        const project = await window.relay.addProjectAt(folder);
        await window.relay.moveProject(project.id, "Work", null);
        return project.id;
      },
      join(root, "backend"),
    );
    await page.reload();

    await page
      .getByRole("button", { name: "Add project", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Add a project",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Import from another app…", exact: true })
      .click();
    await dialog.getByRole("button", { name: /Codex \/ ChatGPT/ }).click();
    await dialog
      .getByRole("button", { name: "Ask an agent…", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: /^Message/ })).toHaveText(
      /^Import my Codex \/ ChatGPT history into Relay\. /,
    );

    // The import tools are this thread's; it reads the history first.
    const sources = await callTool(page, "import_sources", {});
    // Markdown folds its lines together; each project's key comes first.
    const keys = Object.fromEntries(
      [...sources.matchAll(/([0-9a-f]{64})\s+(\S+)/g)].map(([, key, name]) => [
        name,
        key,
      ]),
    );
    expect(Object.keys(keys).sort()).toEqual(["backend", "game", "website"]);
    expect(sources).toContain("[project in Relay]");

    const offered = await callTool(page, "offer_import", {
      projects: [
        { key: keys.backend, group: "Work" },
        { key: keys.website, group: "Work" },
        { key: keys.game, group: "Personal" },
      ],
    });
    expect(offered).toContain("3 projects, 5 chats ticked");
    const card = page.getByRole("region", { name: "Projects to import" });
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Import all 5", exact: true }),
    ).toBeEnabled();

    // The new projects stand in the sidebar, dimmed, before anything's imported.
    const planned = page.locator(".sb-planned");
    await expect(planned).toHaveCount(2);
    await screenshot(page, {
      path: join(tmpdir(), "relay-agent-import-offer.png"),
    });

    // Website goes above Backend; the game stays out, and one chat with it.
    await planned
      .filter({ hasText: "website" })
      .locator(".sb-project-row")
      .dragTo(
        page
          .locator(".sb-project", { hasText: "backend" })
          .locator(".sb-project-row"),
        { targetPosition: { x: 40, y: 3 } },
      );
    await card
      .getByRole("checkbox", { name: "Import game", exact: true })
      .uncheck();
    await expect(planned).toHaveCount(1);
    await card
      .getByRole("checkbox", { name: "Import Polish checkout", exact: true })
      .uncheck();
    await card
      .getByRole("button", { name: "Import selected (3)", exact: true })
      .click();

    await expect(card.getByLabel("Imported")).toHaveCount(2);
    await expect(card).toContainText("skipped");
    await expect(planned).toHaveCount(0);
    const projects = await page.evaluate(() => window.relay.projects());
    expect(
      projects
        .filter((p) => p.folder === "Work")
        .map((p) => p.path.split("/").at(-1)),
    ).toEqual(["website", "backend"]);
    expect(projects.some((p) => p.path.endsWith("/game"))).toBe(false);
    const chats = await page.evaluate(
      (ids) => Promise.all(ids.map((id) => window.relay.projectChats(id))),
      [backend, projects.find((p) => p.path.endsWith("/website"))!.id],
    );
    expect(chats.map((list) => list.length)).toEqual([2, 1]);
    await screenshot(page, {
      path: join(tmpdir(), "relay-agent-import-done.png"),
    });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true, maxRetries: 20 });
  }
});
