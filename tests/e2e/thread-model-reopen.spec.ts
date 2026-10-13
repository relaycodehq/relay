import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

// A thread this window has no composer settings for (started on the phone, or
// in a build of Relay on another origin) must restore its own launch settings,
// even after a new-draft pick changes the shared defaults.
test.setTimeout(60_000);

test("an unopened thread keeps its launch settings after changing a new draft's effort", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-tm-")));
  const repo = join(root, "project"),
    data = join(root, "data"),
    bin = join(root, "bin"),
    capture = join(root, "calls.jsonl");
  await mkdir(repo);
  await mkdir(bin);
  await writeFile(capture, "");
  const script = await readFile(
    resolve("tests/fixtures/room-agent.cjs"),
    "utf8",
  );
  const agentPaths: Record<string, string> = {};
  for (const name of ["claude", "codex"])
    agentPaths[name] = await fakeCli(join(bin, name), script);
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
    lastInput: {
      id: "q",
      body: "@claude hello",
      provider: "claude",
      choice: {
        model: "claude-test-model",
        fast: false,
        reasoningEffort: "max",
      },
      contextWindow: "200k",
      runtimeMode: "auto",
      interactionMode: "plan",
    },
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
      agentPaths,
      projects: [
        {
          id: projectId,
          path: repo,
          name: "project",
          repository: null,
          added: 1,
        },
      ],
      chats: [{ ...chat, messages: undefined, lastInput: undefined }],
      newThreadAgent: "claude",
      newThreadModels: {
        claude: {
          choice: {
            model: "claude-test-model",
            fast: false,
            reasoningEffort: "low",
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
      ...pathWith(env, bin),
      RELAY_AGENT_CAPTURE: capture,
      RELAY_TEST_DATA: data,
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page
      .getByRole("button", { name: /^New thread in project$/i })
      .click();
    const effort = page.getByRole("button", {
      name: "Reasoning effort and context window",
      exact: true,
    });
    await expect(effort).toContainText("Low");
    await effort.click();
    await page
      .getByRole("menuitemradio", { name: "High", exact: true })
      .click();
    await expect(effort).toContainText("High");
    await page
      .locator(".sb-thread", { hasText: "Earlier work" })
      .first()
      .click();
    await expect(page.locator('[data-message-id="a"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose model and provider" }),
    ).toHaveText(/claude-test-model/);
    await expect(effort).toContainText("Max");
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            JSON.parse(localStorage.getItem(`composer-settings:${id}`)!).models
              .claude.contextWindow,
          chat.id,
        ),
      )
      .toBe("200k");
    await expect(
      page.getByRole("combobox", { name: "Runtime mode", exact: true }),
    ).toHaveText("Auto");
    await expect(
      page.getByRole("button", { name: "Mode: Plan", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: join(tmpdir(), "relay-thread-settings-reopen.png"),
    });
    // A local unsent pick belongs to this conversation when it is reopened.
    await effort.click();
    await page.getByRole("menuitemradio", { name: "Low", exact: true }).click();
    await page
      .getByRole("button", { name: /^New thread in project$/i })
      .click();
    await expect(effort).toContainText("High");
    await page
      .locator(".sb-thread", { hasText: "Earlier work" })
      .first()
      .click();
    await expect(effort).toContainText("Low");
    // The restored model is also what is sent, not only what the toolbar shows.
    await page.getByLabel("Message project").fill("Say hello again");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect
      .poll(async () => {
        const calls = (await readFile(capture, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        return calls.find(
          (call) =>
            call.provider === "claude" &&
            call.prompt?.includes("Say hello again"),
        )?.args;
      })
      .toEqual(
        expect.arrayContaining([
          "--model",
          "claude-test-model",
          "--effort",
          "low",
        ]),
      );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
