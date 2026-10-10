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
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { ThreadWorktrees } from "./worktrees";
import { findExecutable } from "../platform/executables";
import { runningSince } from "../terminal-sessions/claude-open";
import { defaultAISettings } from "../../shared/settings";
import { fakeCli } from "../../tests/fixtures/fake-cli";
import {
  claudeTurns,
  writeClaudeSession,
  writeCodexSession,
} from "../../tests/fixtures/terminal-sessions";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string, repo: string, store: Store, chats: ProjectChats;
let projectId: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-continue-")));
  repo = join(root, "repo");
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  await writeFile(join(repo, "cache.ts"), "guard\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "init");
  const cli = await fakeCli(
    join(root, "agent"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude-home"));
  vi.stubEnv("CODEX_HOME", join(root, "codex-home"));
  store = new Store(join(root, "state"));
  await store.load();
  const projects = new Projects(store);
  projectId = (await projects.add(repo, null)).id;
  chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

const HOUR = 3_600_000;
const turns = [
  { prompt: "TERMINAL first", answer: "First answer" },
  { prompt: "TERMINAL second", answer: "Second answer" },
];
const input = (provider: "claude" | "codex", body: string) => ({
  id: randomUUID(),
  body,
  provider,
  runtimeMode: "approval-required" as const,
  interactionMode: "default" as const,
  choice: { ...defaultAISettings.questions, model: "fixture-model" },
});
const calls = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((call) => !String(call.cwd).includes("relay-helper-"));
const claudeText = (call: { prompt: string }) =>
  JSON.parse(call.prompt).message.content.find(
    (p: { type: string }) => p.type === "text",
  ).text as string;
async function sendAndSettle(id: string, provider: "claude" | "codex") {
  const before = (await chats.get(id)).messages.length;
  await chats.send(id, input(provider, `@${provider} RELAY next`));
  await vi.waitFor(async () => {
    const { messages } = await chats.get(id);
    expect(messages).toHaveLength(before + 2);
    expect(messages.at(-1)?.status).toBe("complete");
  });
}

it("resumes a Claude session no terminal holds, sending only what's new", async () => {
  await writeClaudeSession(
    join(root, "claude-home"),
    repo,
    "claude-idle-1",
    claudeTurns(turns),
    { ago: HOUR },
  );
  const [row] = await chats.terminalSessions(projectId);
  expect(row).toMatchObject({
    provider: "claude",
    id: "claude-idle-1",
    live: false,
    turns: 2,
  });
  expect(row).not.toHaveProperty("path");

  const { chat: summary, created } = await chats.continueTerminalSession(
    projectId,
    {
      provider: "claude",
      session: "claude-idle-1",
    },
  );
  expect(created).toBe(true);
  const chat = await chats.get(summary.id);
  expect(chat.title).toBe("TERMINAL first");
  expect(chat.messages.map((m) => m.body)).toEqual([
    "TERMINAL first",
    "First answer",
    "TERMINAL second",
    "Second answer",
  ]);
  expect(chat.fromTerminal).toEqual({
    provider: "claude",
    session: "claude-idle-1",
    how: "resumed",
    open: false,
    through: chat.messages[3]!.id,
  });
  expect(chat.accounts).toEqual({ claude: "default" });
  // Listed again, it points at its thread; picked again, it opens that thread.
  expect((await chats.terminalSessions(projectId))[0]!.chatId).toBe(summary.id);
  expect(
    await chats.continueTerminalSession(projectId, {
      provider: "claude",
      session: "claude-idle-1",
    }),
  ).toMatchObject({ chat: { id: summary.id }, created: false });

  await sendAndSettle(summary.id, "claude");
  const call = (await calls()).find((c) => c.prompt?.includes("RELAY next"));
  expect(call.args).toContain("--resume=claude-idle-1");
  expect(call.args).not.toContain("--fork-session");
  expect(claudeText(call)).not.toContain("TERMINAL first");
  expect(call.cwd).toBe(repo);
});

it("forks a Claude session a terminal still writes to, cut after its last finished answer", async () => {
  await writeClaudeSession(
    join(root, "claude-home"),
    repo,
    "claude-live-1",
    // The terminal is mid-turn: a prompt with no answer yet.
    [
      ...claudeTurns(turns),
      ...claudeTurns([{ prompt: "TERMINAL third", answer: "x" }])
        .slice(0, 1)
        .map((e) => ({ ...e, uuid: "u-third", parentUuid: "system-15" })),
    ],
  );
  const { chat: summary } = await chats.continueTerminalSession(projectId, {
    provider: "claude",
    session: "claude-live-1",
  });
  const chat = await chats.get(summary.id);
  // The turn still running in the terminal stays there.
  expect(chat.messages.map((m) => m.body).at(-1)).toBe("Second answer");
  expect(chat.fromTerminal).toMatchObject({ how: "forked", open: true });
  expect(chat.sessions).toBeUndefined();

  await sendAndSettle(summary.id, "claude");
  const call = (await calls()).find((c) => c.prompt?.includes("RELAY next"));
  expect(call.args).toEqual(
    expect.arrayContaining([
      "--resume=claude-live-1",
      "--fork-session",
      "--resume-session-at=assistant-14",
    ]),
  );
  expect(claudeText(call)).toContain(
    "continues a copy of your session from a terminal, where it is still open",
  );
  expect(claudeText(call)).not.toContain("TERMINAL first");
});

it("forks a quiet Claude session a running claude still lists, unless that pid now runs something else", async () => {
  const home = join(root, "claude-home");
  await writeClaudeSession(home, repo, "claude-held-1", claudeTurns(turns), {
    ago: HOUR,
  });
  const started = (await runningSince([process.pid])).get(process.pid);
  expect(started).toBeTruthy();
  const listed = (procStart: string) =>
    writeFile(
      join(home, "sessions", `${process.pid}.json`),
      JSON.stringify({
        pid: process.pid,
        sessionId: "claude-held-1",
        cwd: repo,
        procStart,
      }),
    );
  await mkdir(join(home, "sessions"));
  // The pid was reused: the claude that listed it started at another time.
  await listed("Thu Jan  1 00:00:00 2026");
  expect((await chats.terminalSessions(projectId))[0]).toMatchObject({
    live: false,
  });
  await listed(started!);
  expect((await chats.terminalSessions(projectId))[0]).toMatchObject({
    live: true,
  });

  const { chat: summary } = await chats.continueTerminalSession(projectId, {
    provider: "claude",
    session: "claude-held-1",
  });
  const chat = await chats.get(summary.id);
  expect(chat.fromTerminal).toMatchObject({ how: "forked", open: true });
  expect(chat.sessions).toBeUndefined();
  expect(chat.messages.at(-1)?.forkPoint).toEqual({
    thread: "claude-held-1",
    at: "assistant-14",
  });
});

it("forks Codex sessions at their last finished turn, whether or not one looks open", async () => {
  const home = join(root, "codex-home");
  await writeCodexSession(home, repo, "codex-idle-01", turns, { ago: HOUR });
  await writeCodexSession(home, repo, "codex-live-01", [
    ...turns,
    { prompt: "TERMINAL running", answer: "half", done: false },
  ]);
  const { chat: idle } = await chats.continueTerminalSession(projectId, {
    provider: "codex",
    session: "codex-idle-01",
  });
  expect((await chats.get(idle.id)).fromTerminal).toMatchObject({
    how: "forked",
    open: false,
  });
  await sendAndSettle(idle.id, "codex");
  const { chat: live } = await chats.continueTerminalSession(projectId, {
    provider: "codex",
    session: "codex-live-01",
  });
  expect((await chats.get(live.id)).messages).toHaveLength(4);
  expect((await chats.get(live.id)).fromTerminal).toMatchObject({
    how: "forked",
    open: true,
  });
  await sendAndSettle(live.id, "codex");

  const threads = (await calls()).filter((c) => c.thread);
  expect(threads.map((c) => c.method)).toEqual(["thread/fork", "thread/fork"]);
  expect(threads[0].thread).toMatchObject({
    threadId: "codex-idle-01",
    lastTurnId: "turn-1",
  });
  expect(threads[1].thread).toMatchObject({
    threadId: "codex-live-01",
    lastTurnId: "turn-1",
  });
  const prompts = (await calls())
    .filter((c) => c.turn)
    .map((c) =>
      c.turn.input.map((i: { text?: string }) => i.text ?? "").join("\n"),
    );
  for (const prompt of prompts) expect(prompt).not.toContain("TERMINAL first");
  expect(prompts[0]).toContain(
    "continues a copy of your session from a terminal, cut after",
  );
  expect(prompts[1]).toContain("where it is still open");
});

it("continues in a new worktree with a copy of the folder's edits when the toggle is on", async () => {
  await writeFile(join(repo, "cache.ts"), "guard fixed in the terminal\n");
  await writeClaudeSession(
    join(root, "claude-home"),
    repo,
    "claude-idle-1",
    claudeTurns(turns),
    { ago: HOUR },
  );
  await writeCodexSession(
    join(root, "codex-home"),
    repo,
    "codex-live-01",
    turns,
  );
  const resumed = await chats.continueTerminalSession(
    projectId,
    { provider: "claude", session: "claude-idle-1" },
    "worktree",
    "relay/from-terminal",
  );
  const forked = await chats.continueTerminalSession(
    projectId,
    { provider: "codex", session: "codex-live-01" },
    "worktree",
  );
  const chat = await chats.get(resumed.chat.id);
  const path = chat.worktree!.path!;
  expect(chat.worktree?.branch).toBe("relay/from-terminal");
  expect(await readFile(join(path, "cache.ts"), "utf8")).toBe(
    "guard fixed in the terminal\n",
  );
  // The project folder keeps its own copy.
  expect(await readFile(join(repo, "cache.ts"), "utf8")).toBe(
    "guard fixed in the terminal\n",
  );
  expect(chat.movedIn).toMatchObject({ from: repo, to: path, copied: true });

  await sendAndSettle(resumed.chat.id, "claude");
  await sendAndSettle(forked.chat.id, "codex");
  const all = await calls();
  const claude = all.find((c) => c.prompt?.includes("RELAY next"));
  expect(claude.cwd).toBe(await realpath(path));
  expect(claude.args).toContain("--resume=claude-idle-1");
  expect(claudeText(claude)).toContain("now continues in its own Git worktree");
  const fork = all.find((c) => c.method === "thread/fork");
  const forkPath = (await chats.get(forked.chat.id)).worktree!.path!;
  expect(fork.thread).toMatchObject({
    threadId: "codex-live-01",
    lastTurnId: "turn-1",
    cwd: forkPath,
  });
  const codexInput = all
    .find((c) => c.turn)
    .turn.input.map((i: { text?: string }) => i.text ?? "")
    .join("\n");
  expect(codexInput).toContain("now continues in its own Git worktree");
  expect(codexInput).toContain(
    "continues a copy of your session from a terminal",
  );
  // Said once.
  expect((await chats.get(resumed.chat.id)).movedIn).toBeUndefined();
});

it("makes one thread for a session picked twice at once, none when its worktree fails, and keeps to an archived one", async () => {
  await writeClaudeSession(
    join(root, "claude-home"),
    repo,
    "claude-idle-1",
    claudeTurns(turns),
    { ago: HOUR },
  );
  await writeCodexSession(
    join(root, "codex-home"),
    repo,
    "codex-idle-01",
    turns,
    { ago: HOUR },
  );
  const pick = { provider: "claude", session: "claude-idle-1" } as const;
  const [first, second] = await Promise.all([
    chats.continueTerminalSession(projectId, pick, "worktree"),
    chats.continueTerminalSession(projectId, pick, "worktree"),
  ]);
  expect([first.created, second.created]).toEqual([true, false]);
  expect(second.chat.id).toBe(first.chat.id);
  expect(second.chat.worktree?.path).toBeTruthy();
  expect(chats.list(projectId)).toHaveLength(1);

  vi.spyOn(ThreadWorktrees.prototype, "copyFor").mockRejectedValueOnce(
    new Error("Disk full"),
  );
  await expect(
    chats.continueTerminalSession(
      projectId,
      { provider: "codex", session: "codex-idle-01" },
      "worktree",
    ),
  ).rejects.toThrow("Disk full");
  expect(chats.list(projectId)).toHaveLength(1);
  expect(
    (await chats.terminalSessions(projectId)).find(
      (r) => r.provider === "codex",
    )?.chatId,
  ).toBeUndefined();

  await chats.triage(first.chat.id, { kind: "archive" });
  expect(
    (await chats.terminalSessions(projectId)).find(
      (r) => r.provider === "claude",
    )?.chatId,
  ).toBe(first.chat.id);
  expect(await chats.continueTerminalSession(projectId, pick)).toMatchObject({
    chat: { id: first.chat.id },
    created: false,
  });
});

it("refuses a session from another folder or one that isn't there", async () => {
  await writeClaudeSession(
    join(root, "claude-home"),
    join(root, "elsewhere"),
    "claude-other1",
    claudeTurns(turns),
  );
  await expect(
    chats.continueTerminalSession(projectId, {
      provider: "claude",
      session: "claude-other1",
    }),
  ).rejects.toThrow("no longer in this project's folder");
  expect(chats.list(projectId)).toHaveLength(0);
});

it("keeps draft links when creating a continued session without changing an existing continuation", async () => {
  await writeClaudeSession(
    join(root, "claude-home"),
    repo,
    "linked-session",
    claudeTurns(turns),
    { ago: HOUR },
  );
  const links = [{ path: join(root, "backend"), access: "read" as const }];
  const first = await chats.continueTerminalSession(
    projectId,
    { provider: "claude", session: "linked-session" },
    "checkout",
    undefined,
    links,
  );
  expect(first.created).toBe(true);
  expect((await chats.get(first.chat.id)).links).toEqual(links);
  const again = await chats.continueTerminalSession(
    projectId,
    { provider: "claude", session: "linked-session" },
    "checkout",
    undefined,
    [],
  );
  expect(again.created).toBe(false);
  expect(again.chat.links).toEqual(links);
});
