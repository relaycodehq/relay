import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ChatSummary } from "../../shared/projects";
import { defaultAISettings } from "../../shared/settings";
import { fakeCli } from "../../tests/fixtures/fake-cli";
import { Store } from "../app/store";
import { findExecutable } from "../platform/executables";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import {
  cleanupKept,
  type CleanupCandidate,
  type CleanupScene,
} from "./worktree-cleanup";

vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));
// A Git run from inside another repository's hook or bisect would act on that one.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
  delete process.env[name];

const day = 86_400_000;

describe("which settled threads' worktrees can go", () => {
  const folder = "/data/worktrees";
  const path = "/data/worktrees/app/fix-cache";
  const thread = (patch: Partial<ChatSummary> = {}): ChatSummary => ({
    id: "t",
    projectId: "p",
    title: "Fix the cache",
    scope: { kind: "project" },
    created: 1_000,
    updated: 1_000,
    worktree: { path, branch: "relay/fix-cache" },
    ...patch,
  });
  const candidate = (
    patch: Partial<ChatSummary> = {},
    more: Partial<CleanupCandidate> = {},
  ): CleanupCandidate => ({
    chat: thread(patch),
    settledSince: 2_000,
    days: 7,
    checkout: "/code/app",
    ...more,
  });
  const scene = (patch: Partial<CleanupScene> = {}): CleanupScene => ({
    now: 2_000 + 7 * day,
    folder,
    chats: [],
    shown: () => false,
    busy: () => false,
    terminal: () => false,
    ...patch,
  });

  it("lets a quiet worktree go the set days after its thread settled", () => {
    expect(cleanupKept(candidate(), scene())).toBeUndefined();
    expect(cleanupKept(candidate(), scene({ now: 2_000 + 7 * day - 1 }))).toBe(
      "not due yet",
    );
    // 0: as soon as it settled.
    expect(
      cleanupKept(candidate({}, { days: 0 }), scene({ now: 2_000 })),
    ).toBeUndefined();
    expect(cleanupKept(candidate({}, { days: null }), scene())).toBe(
      "cleanup is off",
    );
  });

  it("keeps it while the thread isn't settled, as after moving it back", () => {
    expect(
      cleanupKept(candidate({}, { settledSince: undefined }), scene()),
    ).toBe("not settled");
  });

  it("leaves archived threads alone", () => {
    expect(cleanupKept(candidate({ archivedAt: 1_500 }), scene())).toBe(
      "archived",
    );
  });

  it("has nothing to do without a worktree on disk", () => {
    for (const worktree of [
      undefined,
      {},
      { path, branch: "relay/fix-cache", removedAt: 3_000 },
    ])
      expect(cleanupKept(candidate({ worktree }), scene())).toBe(
        "no worktree on disk",
      );
  });

  it("only touches worktrees Relay made, never the checkout", () => {
    for (const worktree of [
      { path: "/elsewhere/fix-cache", branch: "relay/fix-cache" },
      { path, branch: "fix-cache" },
      { path, branch: undefined },
      { path: folder, branch: "relay/fix-cache" },
      { path: "/data/worktrees/../app", branch: "relay/app" },
    ])
      expect(cleanupKept(candidate({ worktree }), scene())).toBe(
        "not a worktree Relay made",
      );
    // A checkout that somehow lives in Relay's folder, or inside the worktree.
    for (const checkout of [path, `${path}/nested`])
      expect(cleanupKept(candidate({}, { checkout }), scene())).toBe(
        "not a worktree Relay made",
      );
  });

  it("keeps it while the thread is handed off or another computer waits for it", () => {
    const cameFrom = {
      id: "h",
      computer: "mini",
      deviceId: "d",
      at: 1_000,
      carried: 2,
      tip: "abc",
    };
    for (const patch of [
      {
        sentTo: {
          id: "h",
          computerId: "c",
          computer: "mini",
          at: 1_000,
          state: "away" as const,
        },
      },
      { cameFrom },
      { cameFrom: { ...cameFrom, returnedAt: 1_500 } },
    ])
      expect(cleanupKept(candidate(patch), scene())).toBe(
        "handed off to another computer",
      );
    // Taken back without this computer: the work here is this thread's own.
    expect(
      cleanupKept(
        candidate({ cameFrom: { ...cameFrom, abandonedAt: 1_500 } }),
        scene(),
      ),
    ).toBeUndefined();
  });

  it("keeps it while an agent works or waits in it", () => {
    for (const patch of [{ running: true }, { waiting: true }])
      expect(cleanupKept(candidate(patch), scene())).toBe(
        "an agent is at work in it",
      );
    expect(cleanupKept(candidate(), scene({ busy: (id) => id === "t" }))).toBe(
      "an agent is at work in it",
    );
  });

  it("keeps it while work is due to run in it", () => {
    for (const patch of [
      {
        pending: [
          { kind: "task" as const, id: "x", description: "vite", since: 1 },
        ],
      },
      { heldWakeups: [{ id: "w", prompt: "check CI", at: 9 * day }] },
      { nextSend: 9 * day },
      { stopped: { at: 1_500, items: [] } },
      { limitResume: { messageId: "m", provider: "claude" as const, at: 1 } },
    ])
      expect(cleanupKept(candidate(patch), scene())).toBe(
        "work is waiting to run in it",
      );
    // A resume turned off waits for nothing.
    expect(
      cleanupKept(
        candidate({
          limitResume: {
            messageId: "m",
            provider: "claude",
            at: 1,
            off: true,
          },
        }),
        scene(),
      ),
    ).toBeUndefined();
  });

  it("keeps the open thread's worktree, and one with a terminal in it", () => {
    expect(cleanupKept(candidate(), scene({ shown: (id) => id === "t" }))).toBe(
      "it's open",
    );
    expect(
      cleanupKept(candidate(), scene({ terminal: (p) => p === path })),
    ).toBe("a terminal is open in it");
  });

  it("keeps a worktree another thread works in too", () => {
    const other = thread({ id: "other" });
    expect(cleanupKept(candidate(), scene({ chats: [other] }))).toBe(
      "another thread works in it",
    );
    // One whose copy of it was removed already doesn't count.
    const gone = thread({
      id: "other",
      worktree: { path, branch: "relay/fix-cache", removedAt: 1_500 },
    });
    expect(
      cleanupKept(candidate(), scene({ chats: [gone, thread()] })),
    ).toBeUndefined();
  });
});

describe("cleaning up a real thread's worktree", () => {
  let root: string;
  let chats: ProjectChats | undefined;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
      { cwd, encoding: "utf8" },
    ).trim();
  const input = (body: string) => ({
    id: randomUUID(),
    body,
    provider: "codex" as const,
    runtimeMode: "full-access" as const,
    interactionMode: "default" as const,
    choice: {
      ...defaultAISettings.questions,
      model: "fixture-model",
      reasoningEffort: "high" as const,
      fast: true,
    },
  });

  afterEach(async () => {
    await chats?.dispose();
    chats = undefined;
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true, maxRetries: 20 });
  });

  /** A worktree thread that answered once, with a commit on its branch, settled by hand. */
  async function settledThread() {
    root = await realpath(await mkdtemp(join(tmpdir(), "relay-cleanup-")));
    const cli = await fakeCli(
      join(root, "codex"),
      await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
    );
    vi.mocked(findExecutable).mockResolvedValue(cli);
    vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
    vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
    const repo = join(root, "repo");
    git(root, "init", "-q", "-b", "main", repo);
    await writeFile(join(repo, "README.md"), "# App\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "First");
    const store = new Store(join(root, "state"));
    await store.load();
    const projects = new Projects(store);
    const projectId = (await projects.add(repo, null)).id;
    chats = new ProjectChats(store, projects, join(root, "chats"), () => {});
    const thread = await chats.create(
      projectId,
      { kind: "project" },
      "worktree",
    );
    await chats.send(thread.id, input("@codex Add a changelog"));
    await finished(thread.id, 2);
    const worktree = (await chats.get(thread.id)).worktree!;
    await writeFile(join(worktree.path!, "CHANGELOG.md"), "- 1.0 First\n");
    git(worktree.path!, "add", "CHANGELOG.md");
    git(worktree.path!, "commit", "-qm", "Changelog");
    await chats.triage(thread.id, { kind: "settle" });
    await store.update((s) => {
      s.worktreeCleanupDays = 0;
    });
    return { chats, store, repo, id: thread.id, worktree };
  }

  async function finished(id: string, count: number) {
    await vi.waitFor(
      async () => {
        const chat = await chats!.get(id);
        expect(chat.messages).toHaveLength(count);
        expect(chat.messages.at(-1)?.status).toBe("complete");
        expect(
          chats!.list(chat.projectId).find((c) => c.id === id)?.running,
        ).toBeFalsy();
      },
      { timeout: 10000 },
    );
  }

  it("removes it but keeps its branch, and the next message checks the branch out again", async () => {
    const { chats, repo, id, worktree } = await settledThread();
    const tip = git(worktree.path!, "rev-parse", "HEAD");

    await chats.cleanUpWorktrees();

    expect(existsSync(worktree.path!)).toBe(false);
    expect(git(repo, "rev-parse", worktree.branch!)).toBe(tip);
    const cleaned = (await chats.get(id)).worktree!;
    expect(cleaned.removedAt).toBeTypeOf("number");
    expect(cleaned.cleanedUp).toBe(true);
    expect(await chats.worktreeStatus(id)).toMatchObject({
      removed: true,
      cleanedUp: true,
      branch: worktree.branch,
    });
    // Saving the removal is no activity: the thread stays settled.
    const listed = chats.list((await chats.get(id)).projectId);
    expect(listed.find((c) => c.id === id)?.settledAt).toBeDefined();

    await chats.send(id, input("@codex And a date on each line"));
    await finished(id, 4);
    const back = (await chats.get(id)).worktree!;
    expect(back.path).toBe(worktree.path);
    expect(back.branch).toBe(worktree.branch);
    expect(back.removedAt).toBeUndefined();
    expect(back.cleanedUp).toBeUndefined();
    expect(await readFile(join(back.path!, "CHANGELOG.md"), "utf8")).toBe(
      "- 1.0 First\n",
    );
  }, 30000);

  it("leaves a worktree with files Git doesn't have yet", async () => {
    const { chats, id, worktree } = await settledThread();
    await writeFile(join(worktree.path!, "notes.md"), "half done\n");
    await chats.cleanUpWorktrees();
    expect(existsSync(join(worktree.path!, "notes.md"))).toBe(true);
    expect((await chats.get(id)).worktree!.removedAt).toBeUndefined();
  }, 30000);

  it("leaves a thread moved back out of Settled, and the one on screen", async () => {
    const { chats, id, worktree } = await settledThread();
    await chats.triage(id, { kind: "unsettle" });
    await chats.cleanUpWorktrees();
    expect(existsSync(worktree.path!)).toBe(true);

    await chats.triage(id, { kind: "settle" });
    await chats.worktreeStatus(id);
    await chats.cleanUpWorktrees();
    expect(existsSync(worktree.path!)).toBe(true);
  }, 30000);
});
