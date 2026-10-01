import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// A thread this window has no composer settings for (started on the phone, or
// in a build of Relay on another origin) used to open on Codex's Default
// instead of the agent that answered and the model last used with it.
test.setTimeout(60_000);

test("opens a thread with no saved settings on its agent and last model", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-tm-")));
  const repo = join(root, "project"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(join(data, "project-chats"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const projectId = randomUUID();
  const start = Date.now() - 86_400_000;
  const chat = {
    id: randomUUID(),
    projectId,
    title: "Earlier work",
    scope: { kind: "project" },
    created: start,
    updated: start + 1000,
    provider: "claude",
    messages: [
      {
        id: "q",
        role: "user",
        provider: "claude",
        status: "complete",
        body: "@claude hello",
        created: start,
        version: 1,
      },
      {
        id: "a",
        role: "assistant",
        provider: "claude",
        status: "complete",
        body: "Hi.",
        created: start + 1000,
        version: 1,
      },
    ],
  };
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
      newThreadAgent: "claude",
      newThreadModels: {
        claude: {
          choice: {
            model: "claude-test-model",
            fast: false,
            reasoningEffort: "",
          },
        },
        codex: {
          choice: { model: "gpt-6-sol", fast: false, reasoningEffort: "high" },
        },
      },
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
    await page.evaluate(() =>
      localStorage.setItem("relay-sidebar-view", "activity"),
    );
    await page.reload();
    await page.locator(".sb-card", { hasText: "Earlier work" }).first().click();
    await expect(page.locator('[data-message-id="a"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/claude-test-model/);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
