import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
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
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { freePort } from "../fixtures/free-port";
import type { AgentProvider } from "../../shared/agents";
import type { ProjectChat } from "../../shared/projects";
import { sentSettingsOf } from "../../shared/projects";

async function seedThread(
  root: string,
  bin: string,
  provider: AgentProvider,
  legacy: boolean,
) {
  const data = join(root, provider);
  const folder = join(root, `${provider}-project`);
  await mkdir(join(data, "project-chats"), { recursive: true });
  await mkdir(folder);
  execFileSync("git", ["init", "-q", "-b", "main", folder]);
  execFileSync("git", [
    "-C",
    folder,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  const projectId = randomUUID();
  const input = {
    id: randomUUID(),
    body: `@${provider} Earlier work`,
    provider,
    choice: {
      model: provider === "claude" ? "claude-opus-5-5" : "gpt-6-sol",
      fast: false,
      reasoningEffort: "high" as const,
    },
    runtimeMode: "auto" as const,
    interactionMode: "default" as const,
  };
  const created = Date.now() - 1000;
  const chat: ProjectChat = {
    id: randomUUID(),
    projectId,
    title: `${provider} work`,
    scope: { kind: "project" },
    created,
    updated: created + 1,
    lastInput: input,
    messages: [
      {
        id: input.id,
        role: "user",
        provider,
        body: input.body,
        status: "complete",
        created,
        version: 1,
        ...(!legacy && { sentSettings: sentSettingsOf(input) }),
      },
      {
        id: randomUUID(),
        role: "assistant",
        provider,
        body: "Earlier answer",
        status: "complete",
        created: created + 1,
        version: 1,
      },
    ],
  };
  await saveThread(data, folder, bin, provider, chat);
  return { chat, data };
}

async function saveThread(
  data: string,
  folder: string,
  bin: string,
  provider: AgentProvider,
  chat: ProjectChat,
) {
  const projectId = chat.projectId;
  await writeFile(
    join(data, "project-chats", `${chat.id}.json`),
    JSON.stringify(chat),
  );
  await writeFile(
    join(data, "state.json"),
    JSON.stringify({
      version: 1,
      folders: {},
      progress: {},
      agentPaths: { claude: join(bin, "claude"), codex: join(bin, "codex") },
      projects: [
        {
          id: projectId,
          path: folder,
          name: provider,
          repository: null,
          added: 1,
        },
      ],
      chats: [{ ...chat, messages: undefined, lastInput: undefined, provider }],
      newThreadAgent: "claude",
    }),
  );
}

async function launchThread(
  root: string,
  bin: string,
  provider: AgentProvider,
  legacy: boolean,
  apps: ElectronApplication[],
) {
  const { chat, data } = await seedThread(root, bin, provider, legacy);
  const capture = join(data, "calls.jsonl");
  await writeFile(capture, "");
  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: data,
      RELAY_REMOTE_PORT: String(await freePort()),
      RELAY_REMOTE_TAILNET: "127.0.0.1",
      RELAY_AGENT_CAPTURE: capture,
      RELAY_AGENT_TURN_MS: "10000",
    },
  });
  apps.push(app);
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(
    page.getByRole("button", { name: /^New thread in/ }).first(),
  ).toBeVisible();
  return { page, chat, capture };
}

async function openThread(page: Page, projectId: string, chatId: string) {
  await page.evaluate(
    (detail) => {
      window.dispatchEvent(new CustomEvent("relay:open-thread", { detail }));
    },
    { projectId, chatId },
  );
  await expect(page.getByLabel("Message project")).toBeVisible();
}

async function sentTurns(capture: string) {
  return (await readFile(capture, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((call) => call.provider === "codex" && call.turn);
}

for (const legacy of [false, true]) {
  test(`switching from Opus restores a remote GPT thread (${legacy ? "legacy" : "current"} settings)`, async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "relay-remote-model-")),
    );
    const apps: ElectronApplication[] = [];
    try {
      const bin = join(root, "bin");
      await mkdir(bin);
      const script = await readFile(
        resolve("tests/fixtures/room-agent.cjs"),
        "utf8",
      );
      for (const provider of ["claude", "codex"])
        await fakeCli(join(bin, provider), script);
      const local = await launchThread(root, bin, "claude", false, apps);
      const remote = await launchThread(root, bin, "codex", legacy, apps);
      const picker = local.page.getByRole("button", {
        name: "Choose model and provider",
      });
      // The same old thread restores correctly on its own computer.
      await openThread(remote.page, remote.chat.projectId, remote.chat.id);
      await expect(
        remote.page.getByRole("button", { name: "Choose model and provider" }),
      ).toContainText("GPT-6-Sol");
      const link = await remote.page.evaluate(async () => {
        await window.relay.setPhoneRemote(true);
        return (await window.relay.phonePairing()).url;
      });
      const computerId = await local.page.evaluate(
        async (url) => (await window.relay.pairComputer(url)).at(-1)!.id,
        link,
      );
      await local.page.reload();
      await openThread(local.page, local.chat.projectId, local.chat.id);
      await expect(picker).toContainText(/opus/i);
      const here = await local.page.evaluate(
        ({ computerId, threadId }) =>
          window.relay.openComputerThread(computerId, threadId),
        { computerId, threadId: remote.chat.id },
      );
      await openThread(local.page, here.projectId, here.chatId);
      await expect(picker).toContainText("GPT-6-Sol");
      // Reload and switch back while running: neither may replace its model.
      await local.page.reload();
      await expect(picker).toContainText("GPT-6-Sol");
      await local.page.getByLabel("Message project").fill("Keep using GPT");
      await local.page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await expect
        .poll(async () => (await sentTurns(remote.capture)).length)
        .toBe(1);
      expect((await sentTurns(remote.capture))[0].turn.model).toBe("gpt-6-sol");
      await openThread(local.page, local.chat.projectId, local.chat.id);
      await expect(picker).toContainText(/opus/i);
      await openThread(local.page, here.projectId, here.chatId);
      await expect(
        local.page.getByRole("button", { name: "Stop answer", exact: true }),
      ).toBeVisible();
      await expect(picker).toContainText("GPT-6-Sol");
      await expect(local.page.getByRole("dialog")).toHaveCount(0);
      await local.page.screenshot({
        path: join(
          tmpdir(),
          `relay-remote-model-${legacy ? "legacy" : "current"}.png`,
        ),
      });
    } finally {
      for (const app of apps) await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
