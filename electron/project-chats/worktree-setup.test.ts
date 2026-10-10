import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { findExecutable } from "../platform/executables";
import { defaultAISettings } from "../../shared/settings";
import { shellQuote } from "../../shared/validation";
import type { ChatMessage, ProjectSettings } from "../../shared/projects";
import { fakeCli } from "../../tests/fixtures/fake-cli";
import { freePortOffset } from "./worktree-setup";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

let root: string, repo: string;
let store: Store, projects: Projects, chats: ProjectChats;
let projectId: string;
let events: { chatId: string; message: ChatMessage }[];
const watchers: FSWatcher[] = [];
function fileSignal(file: string) {
  return new Promise<void>((resolve, reject) => {
    const watcher = watch(dirname(file), () => {
      if (!existsSync(file)) return;
      watcher.close();
      resolve();
    });
    watchers.push(watcher);
    watcher.on("error", reject);
    if (existsSync(file)) {
      watcher.close();
      resolve();
    }
  });
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-setup-")));
  repo = join(root, "repo");
  await mkdir(repo);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(repo, ".gitignore"), ".env\n");
  await writeFile(join(repo, ".worktreeinclude"), ".env\n");
  git("add", ".");
  git("commit", "-qm", "Initial");
  await writeFile(join(repo, ".env"), "SECRET=1\n");
  const cli = await fakeCli(
    join(root, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
  store = new Store(join(root, "state"));
  await store.load();
  projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  events = [];
  chats = new ProjectChats(store, projects, join(root, "chats"), (event) =>
    events.push(structuredClone(event)),
  );
});
afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.close();
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const input = (body: string) => ({
  id: randomUUID(),
  body,
  provider: "codex" as const,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});
const settle = (settings: ProjectSettings) =>
  projects.saveSettings(projectId, { workspace: "worktree", ...settings });
const answered = (id: string, count: number) =>
  vi.waitFor(async () => {
    const { messages } = await chats.get(id);
    expect(messages).toHaveLength(count);
    expect(messages.at(-1)?.status).toBe("complete");
    expect(messages.at(-1)?.worktreeCommand).toBeUndefined();
  });
const turns = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .filter((line) => !/^\{"cwd":"[^"]*relay-helper-/.test(line))
    .map((line) => JSON.parse(line))
    .filter((call) => call.turn);
const promptOf = (call: { turn: { input: { text?: string }[] } }) =>
  call.turn.input.map((i) => i.text ?? "").join("\n");

it("hands out the smallest offset no other worktree holds", () => {
  expect(freePortOffset([])).toBe(10);
  expect(freePortOffset([10, 20, 40])).toBe(30);
  expect(freePortOffset([20])).toBe(10);
});

it("runs setup before the first answer, shows it, and tells the agent it failed", async () => {
  await settle({
    worktreeSetup: 'cat .env; echo "port +$RELAY_PORT_OFFSET"; exit 3',
  });
  const chat = await chats.create(projectId, { kind: "project" }, "worktree");
  await chats.send(chat.id, input("@codex Start the dev server"));
  await answered(chat.id, 3);

  const [, setup, answer] = (await chats.get(chat.id)).messages;
  expect(setup!.status).toBe("failed");
  expect(setup!.worktreeCommand).toMatchObject({
    kind: "setup",
    exitCode: 3,
    copied: [".env"],
  });
  expect(setup!.worktreeCommand!.output).toBe("SECRET=1\nport +10\n");
  expect(answer!.worktreeCommand).toBeUndefined();
  // The row streamed, then ended; the answer only started after it.
  const statuses = events
    .filter((e) => e.message.id === setup!.id)
    .map((e) => e.message.status);
  expect(statuses[0]).toBe("streaming");
  expect(statuses.at(-1)).toBe("failed");
  expect(events.findIndex((e) => e.message.id === answer!.id)).toBeGreaterThan(
    events.findIndex((e) => e.message.status === "failed"),
  );

  const [turn] = await turns();
  expect(turn.portOffset).toBe("10");
  expect(promptOf(turn)).toContain("failed with exit code 3");
  expect(promptOf(turn)).toContain("port +10");
  // Told once; the next turn doesn't hear it again.
  await chats.send(chat.id, input("@codex And now?"));
  await answered(chat.id, 5);
  expect(promptOf((await turns())[1])).not.toContain("setup command");
});

it("runs a failed setup again in its row, and the agent hears it passed", async () => {
  const marker = join(root, "attempts");
  await settle({
    worktreeSetup: `echo x >> ${JSON.stringify(marker)}; [ $(wc -l < ${JSON.stringify(marker)}) -ge 2 ]`,
  });
  const chat = await chats.create(projectId, { kind: "project" }, "worktree");
  await chats.send(chat.id, input("@codex Build it"));
  await answered(chat.id, 3);
  const setup = (await chats.get(chat.id)).messages[1]!;
  expect(setup.status).toBe("failed");

  await chats.rerunWorktreeSetup(chat.id, setup.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages[1]!.status).toBe("complete"),
  );
  // Same row, no new one.
  expect((await chats.get(chat.id)).messages).toHaveLength(3);
  await expect(chats.rerunWorktreeSetup(chat.id, setup.id)).rejects.toThrow(
    "already went through",
  );

  await chats.send(chat.id, input("@codex Try again"));
  await answered(chat.id, 5);
  expect(promptOf((await turns())[1])).toContain("ran again and passed");
});

it("leaves a project without setup alone, and runs teardown before removing the worktree", async () => {
  const torn = join(root, "torn");
  await settle({
    worktreeTeardown: `echo "$RELAY_PORT_OFFSET" > ${JSON.stringify(torn)}`,
  });
  const chat = await chats.create(projectId, { kind: "project" }, "worktree");
  await chats.send(chat.id, input("@codex Hello"));
  await answered(chat.id, 2);
  const path = (await chats.get(chat.id)).worktree!.path!;
  expect(await readFile(join(path, ".env"), "utf8")).toBe("SECRET=1\n");

  await chats.removeWorktree(chat.id);
  expect(await readFile(torn, "utf8")).toBe("10\n");
  expect((await chats.get(chat.id)).messages).toHaveLength(2);
});

it("archives at once and tears the worktree down after", async () => {
  const torn = join(root, "torn"),
    ready = join(root, "teardown-ready"),
    release = join(root, "release-teardown"),
    script = join(root, "teardown.cjs");
  await writeFile(
    script,
    `
    const fs = require('node:fs');
    const finish = () => {
      if (fs.existsSync(${JSON.stringify(release)})) {
        fs.writeFileSync(${JSON.stringify(torn)}, 'done');
        process.exit();
      }
    };
    fs.watch(${JSON.stringify(root)}, finish);
    fs.writeFileSync(${JSON.stringify(ready + ".tmp")}, 'ready');
    fs.renameSync(${JSON.stringify(ready + ".tmp")}, ${JSON.stringify(ready)});
    finish();
  `,
  );
  await settle({
    worktreeTeardown: [process.execPath, script]
      .map((arg) =>
        process.platform === "win32" ? JSON.stringify(arg) : shellQuote(arg),
      )
      .join(" "),
  });
  const chat = await chats.create(projectId, { kind: "project" }, "worktree");
  await chats.send(chat.id, input("@codex Hello"));
  await answered(chat.id, 2);

  const readySignal = fileSignal(ready);
  let archived = false;
  const archiving = chats.triage(chat.id, { kind: "archive" }).then(() => {
    archived = true;
  });
  try {
    await readySignal;
    expect(await readFile(ready, "utf8")).toBe("ready");
    // Archiving must finish while teardown is explicitly held open.
    expect(archived).toBe(true);
    expect((await chats.get(chat.id)).archivedAt).toBeDefined();
    expect((await chats.get(chat.id)).worktree!.removedAt).toBeUndefined();
    expect(existsSync(torn)).toBe(false);
  } finally {
    await writeFile(release, "release");
    await archiving;
  }
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).worktree!.removedAt).toBeDefined(),
  );
  expect(existsSync(torn)).toBe(true);
});

it("shows a failed teardown in the thread but removes the worktree anyway", async () => {
  await settle({ worktreeTeardown: "echo stuck; exit 4" });
  const chat = await chats.create(projectId, { kind: "project" }, "worktree");
  await chats.send(chat.id, input("@codex Hello"));
  await answered(chat.id, 2);

  await chats.removeWorktree(chat.id);
  const { messages, worktree } = await chats.get(chat.id);
  expect(worktree!.removedAt).toBeDefined();
  expect(messages.at(-1)).toMatchObject({
    status: "failed",
    worktreeCommand: { kind: "teardown", exitCode: 4, output: "stuck\n" },
  });
});

it("stopping the turn during setup stops setup, and no answer starts", async () => {
  await settle({ worktreeSetup: "echo installing; sleep 30" });
  const chat = await chats.create(projectId, { kind: "project" }, "worktree");
  await chats.send(chat.id, input("@codex Build it"));
  await vi.waitFor(async () =>
    expect(
      (await chats.get(chat.id)).messages[1]?.worktreeCommand?.output,
    ).toBe("installing\n"),
  );

  await chats.cancel(chat.id);
  await vi.waitFor(async () =>
    expect((await chats.get(chat.id)).messages[1]?.status).toBe("cancelled"),
  );
  const { messages } = await chats.get(chat.id);
  expect(messages).toHaveLength(2);
  expect(messages[1]!.worktreeCommand!.stopped).toBe("cancelled");
});
