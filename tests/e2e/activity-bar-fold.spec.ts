import {
  relayEnv,
  test,
  expect,
  _electron as electron,
} from "../fixtures/electron";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

test("the activity bar folds away with the sidebar and peeks back with it", async () => {
  const data = await mkdtemp(join(tmpdir(), "relay-bar-fold-"));
  await mkdir(join(data, "config"), { recursive: true });
  await writeFile(
    join(data, "config", "settings.json"),
    JSON.stringify({ activityBar: { foldsWithSidebar: true } }),
  );
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: data },
  });
  try {
    const page = await app.firstWindow();
    const bar = page.getByRole("navigation", { name: "Activity bar" });
    const sidebar = page.locator(".projects-sidebar");
    await expect(bar).toBeVisible();

    await page.getByTitle(/^Hide sidebar/).click();
    await expect(bar).toBeHidden();
    await expect(sidebar).toBeHidden();
    // The page takes the bar's room too.
    const layout = page.locator(".project-layout");
    await expect(layout).toHaveCSS("padding-left", "0px");

    // The window's own edge peeks both, and the pointer can cross the bar
    // into the sidebar without either folding.
    const { y, height } = (await layout.boundingBox())!;
    const middle = y + height / 2;
    await page.mouse.move(4, middle);
    await expect(bar).toBeVisible();
    await expect(sidebar).toBeVisible();
    await page.mouse.move(26, middle, { steps: 4 });
    const barBox = (await bar.boundingBox())!;
    await page.mouse.move(barBox.x + barBox.width + 60, middle, { steps: 6 });
    await page.waitForTimeout(400);
    await expect(bar).toBeVisible();
    await expect(sidebar).toBeVisible();

    await page.mouse.move(1000, middle, { steps: 6 });
    await expect(bar).toBeHidden();
    await expect(sidebar).toBeHidden();

    // Settings keeps the bar, whose button is the way back.
    await page.mouse.move(4, middle);
    await bar.getByRole("button", { name: "Open settings" }).click();
    await page.mouse.move(1000, middle, { steps: 6 });
    await page.waitForTimeout(400);
    await expect(bar).toBeVisible();
    await expect(layout).not.toHaveCSS("padding-left", "0px");
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

/** A short finished thread, enough prompts for the prompt rail. */
function thread(projectId: string): ProjectChat {
  const start = Date.now() - 600_000;
  const messages: ChatMessage[] = Array.from({ length: 6 }, (_, i) => ({
    id: `m-${i}`,
    role: i % 2 ? "assistant" : "user",
    provider: "codex",
    status: "complete",
    body: i % 2 ? `Answer ${i}.` : `Question ${i}?`,
    created: start + i * 60_000,
    ended: start + i * 60_000 + 5_000,
    version: 1,
  }));
  return {
    id: randomUUID(),
    projectId,
    title: "Rail",
    scope: { kind: "project" },
    created: start,
    updated: start + 360_000,
    messages,
  };
}

test("resting on the prompt rail at the window's edge doesn't peek the sidebar", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-bar-rail-")));
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin");
  try {
    await mkdir(repo);
    // The fixture agent stands in for both CLIs, so nothing real starts.
    await mkdir(bin);
    const agent = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const name of ["codex", "claude"])
      await fakeCli(join(bin, name), agent);
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    await mkdir(join(data, "project-chats"), { recursive: true });
    await mkdir(join(data, "config"), { recursive: true });
    await writeFile(
      join(data, "config", "settings.json"),
      JSON.stringify({ activityBar: { foldsWithSidebar: true } }),
    );
    const projectId = randomUUID();
    const chat = thread(projectId);
    await writeFile(
      join(data, "project-chats", chat.id + ".json"),
      JSON.stringify(chat),
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
        chats: [{ ...chat, messages: undefined }],
      }),
    );
    const env = relayEnv();
    const app = await electron.launch({
      env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: data },
    });
    try {
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.locator(".sb-thread", { hasText: "Rail" }).click();
      await page.getByTitle(/^Hide sidebar/).click();
      const sidebar = page.locator(".projects-sidebar");
      await expect(sidebar).toBeHidden();

      const rail = page.locator(".thread-timeline-rail");
      await rail.waitFor({ state: "attached" });
      const box = (await rail.boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 4, y, { steps: 3 });
      await page.waitForTimeout(500);
      await expect(sidebar).toBeHidden();

      // Left of the rail the edge still peeks.
      await page.mouse.move(0, y);
      await expect(sidebar).toBeVisible();
    } finally {
      await app.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
