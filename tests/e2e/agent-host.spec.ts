import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fakeCli, pathWith } from "../fixtures/fake-cli";

const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
  ),
) as Record<string, string>;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

type Answer = { id: string; body: string; status: string };

/**
 * A project with one thread, in a Relay that the test restarts the way a
 * rebuild does. `agents` names the stand-in CLIs, by the fixture each runs.
 */
async function restartable(
  agents: Record<string, string>,
  extra: Record<string, string> = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-host-")));
  const repo = join(root, "project"),
    bin = join(root, "bin"),
    data = join(root, "data");
  await mkdir(repo);
  await mkdir(bin);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Relay test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
  for (const [name, fixture] of Object.entries(agents))
    await fakeCli(
      join(bin, name),
      await readFile(resolve("tests/fixtures", fixture), "utf8"),
    );
  const launch = () =>
    electron.launch({
      args: ["tests/fixtures/launch.cjs"],
      env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: data, ...extra },
    });
  let app: ElectronApplication = await launch();
  let page: Page = await app.firstWindow();
  await app.evaluate(({ dialog }, repo) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [repo],
    });
  }, repo);
  const project = await page.evaluate(() => window.relay.addProject());
  const chat = await page.evaluate(
    (id) => window.relay.createProjectChat(id, { kind: "project" }),
    project!.id,
  );
  return {
    get app() {
      return app;
    },
    send: (
      input: Partial<Parameters<typeof window.relay.sendProjectChat>[1]>,
    ) =>
      page.evaluate(
        ({ chatId, input }) =>
          window.relay.sendProjectChat(chatId, {
            id: crypto.randomUUID(),
            choice: { model: "", fast: false, reasoningEffort: "" },
            runtimeMode: "full-access",
            interactionMode: "default",
            ...input,
          } as Parameters<typeof window.relay.sendProjectChat>[1]),
        { chatId: chat.id, input },
      ),
    state: () => page.evaluate((id) => window.relay.projectChat(id), chat.id),
    approve: (request: string) =>
      page.evaluate(
        ({ chatId, request }) =>
          window.relay.respondProjectChat(chatId, request, {
            kind: "approval",
            decision: "accept",
          }),
        { chatId: chat.id, request },
      ),
    answers: async () =>
      (
        await page.evaluate((id) => window.relay.projectChat(id), chat.id)
      ).messages.filter(
        (m: any) => typeof m === "object" && m.role === "assistant",
      ) as Answer[],
    /** A rebuild restarts Relay with a signal. */
    restart: async () => {
      const exited = new Promise((r) => app.process().once("exit", r));
      app.process().kill("SIGTERM");
      await exited;
      app = await launch();
      page = await app.firstWindow();
    },
    hosts: async () =>
      (await readdir(join(data, "agent-host")).catch(() => [] as string[]))
        .map((name) => /^host-(\d+)\.json$/.exec(name)?.[1])
        .filter(Boolean)
        .map(Number),
    async dispose() {
      await app.close().catch(() => {});
      for (const pid of await this.hosts())
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Claude keeps answering while Relay restarts, and the answer finishes in place", async () => {
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-starts-")));
  const starts = join(root, "claude-starts.log");
  const relay = await restartable(
    { claude: "slow-claude.cjs" },
    { SLOW_CLAUDE_LOG: starts, SLOW_CLAUDE_MS: "300" },
  );
  try {
    await relay.send({
      body: "@claude Count to twenty",
      provider: "claude",
    });
    await expect
      .poll(async () => (await relay.answers())[0]?.body ?? "", {
        timeout: 20_000,
      })
      .toContain("three");
    const [cut] = await relay.answers();
    expect(cut.status).toBe("streaming");

    await relay.restart();
    expect(await relay.hosts()).toHaveLength(1);
    await expect
      .poll(
        async () =>
          (await relay.answers()).map((m) => [m.id, m.status, m.body]),
        {
          timeout: 30_000,
        },
      )
      .toEqual([
        [
          cut.id,
          "complete",
          "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty",
        ],
      ]);
    // One Claude Code the whole way: carried on, not started over.
    const pids = (await readFile(starts, "utf8"))
      .trim()
      .split("\n")
      .map(Number);
    expect(pids).toHaveLength(1);

    // Quitting for real ends the session, and its Claude Code with it.
    await relay.app.close();
    await expect.poll(() => alive(pids[0]), { timeout: 10_000 }).toBe(false);
  } finally {
    await relay.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex keeps streaming while Relay restarts, and the answer isn't written twice", async () => {
  test.setTimeout(150_000);
  const relay = await restartable({
    codex: "room-agent.cjs",
    claude: "room-agent.cjs",
  });
  try {
    await relay.send({ body: "@codex fixture stream long", provider: "codex" });
    await expect
      .poll(async () => (await relay.answers())[0]?.body ?? "", {
        timeout: 20_000,
      })
      .toContain("Paragraph 2.");
    const [cut] = await relay.answers();
    expect(cut.status).toBe("streaming");

    await relay.restart();
    await expect
      .poll(async () => (await relay.answers()).map((m) => [m.id, m.status]), {
        timeout: 90_000,
      })
      .toEqual([[cut.id, "complete"]]);
    const [done] = await relay.answers();
    // Replayed from where the turn began, not stacked on what was kept.
    expect(done.body.split("Paragraph 0.")).toHaveLength(2);
    expect(done.body).toContain("Paragraph 239.");
  } finally {
    await relay.dispose();
  }
});

test("OpenCode asks again after a restart, and the answer finishes once it's allowed", async () => {
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-oc-")));
  const capture = join(root, "opencode.jsonl");
  const relay = await restartable(
    {
      opencode: "opencode-server.cjs",
      codex: "room-agent.cjs",
      claude: "room-agent.cjs",
    },
    { RELAY_OPENCODE_CAPTURE: capture },
  );
  try {
    await relay.send({
      body: "@opencode Write notes.md",
      provider: "opencode",
      choice: { model: "zen/pickle", fast: false, reasoningEffort: "" },
      runtimeMode: "approval-required",
    });
    const asked = async () =>
      (await relay.state()).requests as { id: string; title: string }[];
    await expect
      .poll(async () => (await asked()).length, { timeout: 30_000 })
      .toBe(1);
    const [cut] = await relay.answers();

    // Relay goes away with the edit waiting on the user.
    await relay.restart();
    await expect
      .poll(async () => (await asked()).length, { timeout: 30_000 })
      .toBe(1);
    const [again] = await asked();
    await relay.approve(again.id);
    await expect
      .poll(
        async () =>
          (await relay.answers()).map((m) => [m.id, m.status, m.body]),
        { timeout: 30_000 },
      )
      .toEqual([[cut.id, "complete", "Wrote notes.md."]]);
    // The prompt went out once: the restart picked the turn up, not sent it again.
    const calls = (await readFile(capture, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const thread = (await relay.state()).sessions?.opencode?.thread;
    expect(
      calls.filter((c) => c.path === `/session/${thread}/prompt_async`),
    ).toHaveLength(1);
    expect(calls.find((c) => c.path.startsWith("/permission/"))?.body).toEqual({
      reply: "once",
    });
  } finally {
    await relay.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
