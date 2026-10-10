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

// A thread left while its answer streams keeps a cached copy that still says
// so. Events for threads that aren't open are ignored, so nothing corrects it
// but the refetch on opening; the 1s poll that follows a streaming copy is too
// slow to count on.
test.setTimeout(90_000);

test("shows a thread's finished answer at once when it is opened again", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-fin-")));
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
  const other = {
    id: randomUUID(),
    projectId,
    title: "Other",
    scope: { kind: "project" },
    created: start,
    updated: start + 1000,
    messages: [
      {
        id: "other-0",
        role: "user",
        provider: "claude",
        status: "complete",
        body: "hello",
        created: start,
        version: 1,
      },
    ],
  };
  await writeFile(
    join(data, "project-chats", other.id + ".json"),
    JSON.stringify(other),
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
      chats: [{ ...other, messages: undefined }],
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
      SLOW_CLAUDE_MS: "250",
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    // A streaming copy's one-second poll must not rescue a missing refetch on opening.
    await page.addInitScript(() => {
      const setInterval = window.setInterval.bind(window);
      window.setInterval = ((
        handler: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) =>
        setInterval(
          delay === 1000 ? () => {} : handler,
          delay,
          ...args,
        )) as typeof window.setInterval;
    });
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "New thread", exact: true })
      .first()
      .click();
    const input = page.getByLabel("Message project");
    await expect(input).toBeEditable();
    await input.fill("@claude Count to twenty please");
    await input.press("Enter");
    const stop = page.getByRole("button", { name: "Stop answer", exact: true });
    await expect(stop).toBeVisible();
    // Watching it stream for a moment, then leaving for another thread.
    await expect
      .poll(
        async () =>
          (await page
            .locator(".project-messages [data-message-id]")
            .last()
            .textContent()) ?? "",
        { timeout: 15000 },
      )
      .toContain("three");
    await page.locator(".sb-card", { hasText: "Other" }).first().click();
    await expect(
      page.locator(`.project-messages [data-message-id="other-0"]`),
    ).toBeVisible();
    // The sidebar knows it's done once the card no longer says it's running.
    const card = page.locator(".sb-card", { hasText: "Count to twenty" });
    await expect(card).toBeVisible();
    await expect
      .poll(async () => (await card.first().textContent()) ?? "", {
        timeout: 30000,
      })
      .not.toMatch(/Working|Running/i);
    // Finished for certain, but well inside the 30s a cached copy counts as fresh.
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const summaries = await window.relay.projectChats(id);
          const chat = summaries.find((chat) =>
            chat.title?.includes("Count to twenty"),
          );
          if (!chat || chat.running) return false;
          const current = await window.relay.projectChat(chat.id);
          const last = current.messages.at(-1);
          return typeof last === "object" && last.status === "complete";
        }, projectId),
      )
      .toBe(true);
    await card.first().click();
    // Polling is disabled: opening must refetch the cached streaming copy.
    await expect(
      page.locator(".project-messages [data-message-id]").last(),
    ).toContainText("twenty");
    await expect(page.getByText(/Working for/)).toHaveCount(0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
