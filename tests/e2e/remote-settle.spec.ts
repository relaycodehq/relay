import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
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
import type { ProjectChat } from "../../shared/projects";

async function remoteThread(root: string, bin: string) {
  const data = join(root, "remote");
  const folder = join(root, "project");
  await mkdir(join(data, "project-chats"), { recursive: true });
  await mkdir(folder);
  execFileSync("git", ["init", "-q", "-b", "main", folder]);
  const projectId = randomUUID();
  const created = Date.now() - 1000;
  const chat: ProjectChat = {
    id: randomUUID(),
    projectId,
    title: "Remote work",
    renamed: true,
    scope: { kind: "project" },
    created,
    updated: created + 1,
    messages: [
      {
        id: randomUUID(),
        role: "user",
        provider: "codex",
        body: "Earlier work",
        status: "complete",
        created,
        version: 1,
      },
      {
        id: randomUUID(),
        role: "assistant",
        provider: "codex",
        body: "Earlier answer",
        status: "complete",
        created: created + 1,
        version: 1,
      },
    ],
  };
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
      agentPaths: { codex: join(bin, "codex"), claude: join(bin, "claude") },
      projects: [
        {
          id: projectId,
          path: folder,
          name: "Project",
          repository: null,
          added: 1,
        },
      ],
      chats: [{ ...chat, messages: undefined, provider: "codex" }],
    }),
  );
  return { chat, data };
}

test("settling on the thread's computer updates its controller, which can reopen and undo it", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-remote-settle-")),
  );
  const apps: ElectronApplication[] = [];
  try {
    const bin = join(root, "bin");
    await mkdir(bin);
    const script = await readFile(
      resolve("tests/fixtures/room-agent.cjs"),
      "utf8",
    );
    for (const provider of ["codex", "claude"])
      await fakeCli(join(bin, provider), script);
    const { chat, data } = await remoteThread(root, bin);
    const launch = async (data: string) => {
      const env = relayEnv();
      const app = await electron.launch({
        env: {
          ...env,
          ...pathWith(env, bin),
          RELAY_TEST_DATA: data,
          RELAY_REMOTE_PORT: String(await freePort()),
          RELAY_REMOTE_TAILNET: "127.0.0.1",
          RELAY_AGENT_TURN_MS: "20",
          RELAY_AGENT_NO_TITLE: "1",
        },
      });
      apps.push(app);
      const page = await app.firstWindow();
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.evaluate(() =>
        localStorage.setItem("relay-sidebar-view", "activity"),
      );
      await page.reload();
      await expect(
        page
          .getByRole("button", { name: "Open settings", exact: true })
          .first(),
      ).toBeVisible();
      return page;
    };
    const remote = await launch(data);
    const local = await launch(join(root, "local"));
    const link = await remote.evaluate(async () => {
      await window.relay.setPhoneRemote(true);
      return (await window.relay.phonePairing()).url;
    });
    const computerId = await local.evaluate(
      async (url) => (await window.relay.pairComputer(url)).at(-1)!.id,
      link,
    );
    const here = await local.evaluate(
      ({ computerId, threadId }) =>
        window.relay.openComputerThread(computerId, threadId),
      { computerId, threadId: chat.id },
    );
    await local.reload();
    await local.evaluate(
      (detail) =>
        window.dispatchEvent(new CustomEvent("relay:open-thread", { detail })),
      here,
    );
    await expect(
      local.getByText("Earlier answer", { exact: true }),
    ).toBeVisible();
    await local.getByLabel("Message project").fill("@codex One more thing");
    await local
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      local.getByText("The cache guard prevents duplicate requests.", {
        exact: true,
      }),
    ).toBeVisible();
    const remoteCard = remote.locator(".sb-card", { hasText: "Remote work" });
    const localCard = local.locator(".sb-card", { hasText: "Remote work" });
    const strip = local.locator(".waiting-strip.settled");
    await remoteCard.hover();
    await remoteCard
      .getByRole("button", { name: "Settle", exact: true })
      .click();
    await expect(strip).toBeVisible();
    await expect(localCard).toHaveCount(0);
    await local.screenshot({
      path: join(tmpdir(), "relay-remote-settled.png"),
    });
    await strip.getByRole("button", { name: "Unsettle", exact: true }).click();
    await expect(strip).toHaveCount(0);
    await expect(localCard).toBeVisible();
    await expect(remoteCard).toBeVisible();
    await localCard.hover();
    await localCard
      .getByRole("button", { name: "Settle", exact: true })
      .click();
    await expect(remoteCard).toHaveCount(0);
    await local.keyboard.press(
      process.platform === "darwin" ? "Meta+z" : "Control+z",
    );
    await expect(localCard).toBeVisible();
    await expect(remoteCard).toBeVisible();
  } finally {
    for (const app of apps) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
