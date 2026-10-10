import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "../project-chats";
import { PhoneRemote } from "../remote/phone-remote";
import { Computers } from "./computers";
import { HandoffReceiver } from "./receiver";
import { Handoffs, outdated } from "./sender";
import { awaitsReturn } from "../project-chats/handoff";
import { handoffBridge } from "../../shared/remote";
import { handoffMessagesSchema } from "../../shared/handoff";
import type { UpdateState } from "../../shared/updates";
import { findExecutable } from "../platform/executables";
import { defaultAISettings } from "../../shared/settings";
import { RemoteClient } from "../../shared/remote-client";
import { parsePairingUrl } from "../../shared/remote";
import { fakeCli } from "../../tests/fixtures/fake-cli";
vi.mock("../platform/executables", async (actual) => ({
  ...(await actual<typeof import("../platform/executables")>()),
  findExecutable: vi.fn(),
}));

let root: string;
const cleanup: (() => Promise<unknown> | unknown)[] = [];
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" },
  ).trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "relay-handoff-")));
  const cli = await fakeCli(
    join(root, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  vi.mocked(findExecutable).mockResolvedValue(cli);
  vi.stubEnv("RELAY_AGENT_CAPTURE", join(root, "capture.jsonl"));
  vi.stubEnv("RELAY_AGENT_NO_TITLE", "1");
  // The shared remote both computers cloned; `me/app` is how they match.
  const origin = join(root, "remote", "me", "app.git");
  await mkdir(origin, { recursive: true });
  git(origin, "init", "--bare", "-q", "-b", "main");
  const seed = join(root, "seed");
  git(root, "clone", "-q", origin, seed);
  await writeFile(join(seed, "README.md"), "# App\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "First");
  git(seed, "push", "-q", "origin", "HEAD:main");
});
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true, maxRetries: 20 });
});

/** One computer running Relay: its own data, and its own clone of the app. */
async function computer(name: string) {
  const dir = join(root, name);
  const clone = join(dir, "app");
  await mkdir(dir, { recursive: true });
  git(dir, "clone", "-q", join(root, "remote", "me", "app.git"), clone);
  const store = new Store(join(dir, "state"));
  await store.load();
  const projects = new Projects(store);
  const projectId = (await projects.add(clone, null)).id;
  const chats = new ProjectChats(store, projects, join(dir, "chats"), () => {});
  cleanup.push(() => chats.dispose());
  return { dir, clone, store, projects, projectId, chats };
}

/** The mini's updater: one newer release on the feed, installed when asked. */
function fakeUpdater() {
  const calls: string[] = [];
  let state: UpdateState = { status: "idle", current: "0.9.0" };
  return {
    calls,
    state: () => state,
    check: async () => {
      calls.push("check");
      return (state = {
        status: "available",
        current: "0.9.0",
        version: "0.9.1",
        install: "auto",
      });
    },
    download: async () => {
      calls.push("download");
      return (state = { status: "ready", current: "0.9.0", version: "0.9.1" });
    },
    install: async () => {
      calls.push("install");
      return (state = {
        status: "installing",
        current: "0.9.0",
        version: "0.9.1",
      });
    },
  };
}

async function pairedComputers() {
  const laptop = await computer("laptop");
  const mini = await computer("mini");
  const updater = fakeUpdater();
  const seal = async (v: string) => "sealed:" + v,
    unseal = async (v: string) => v.slice(7);
  const remote = new PhoneRemote(
    mini.store,
    seal,
    unseal,
    {
      projects: () => mini.projects.list(null),
      projectPath: (id) => mini.projects.get(id).path,
      chats: (id) => mini.chats.list(id),
      chat: (id) => mini.chats.get(id),
      dispatch: async () => undefined,
      handoffs: new HandoffReceiver({
        projects: () => mini.projects.list(null),
        root: (id) => mini.projects.root(id),
        chats: mini.chats,
        worktrees: join(mini.dir, "worktrees"),
        dir: join(mini.dir, "handoffs"),
        version: () => "0.9.0",
        updates: updater,
      }),
    },
    0,
    async () => ({ status: "connected", addresses: ["127.0.0.1"] }),
  );
  await remote.setEnabled(true);
  cleanup.push(() => remote.close());
  const computers = new Computers(laptop.store, seal, unseal, {
    timeoutMs: 5000,
  });
  cleanup.push(() => computers.close());
  const [paired] = await computers.pair((await remote.pairing()).url);
  await vi.waitFor(() => expect(computers.status(paired!.id)).toBe("online"));
  const sender = new Handoffs(
    laptop.store,
    computers,
    laptop.chats,
    laptop.projects,
    join(laptop.dir, "handoffs"),
  );
  return {
    laptop,
    mini,
    remote,
    computers,
    sender,
    updater,
    computerId: paired!.id,
  };
}

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

async function finished(chats: ProjectChats, id: string, count?: number) {
  await vi.waitFor(async () => {
    const chat = await chats.get(id);
    if (count) expect(chat.messages).toHaveLength(count);
    expect(chat.messages.at(-1)?.status).toBe("complete");
    // The answer shows as finished a moment before it gives the thread back.
    expect(
      chats.list(chat.projectId).find((c) => c.id === id)?.running,
    ).toBeFalsy();
  });
}

const prompts = async () =>
  (await readFile(join(root, "capture.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((c) => c.turn)
    .map((c) =>
      (c.turn.input as { text?: string }[]).map((i) => i.text).join("\n"),
    );

it("hands a worktree thread to the other computer and brings it back", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  await laptop.chats.send(
    thread.id,
    input("@codex Keep it short, one line per release"),
  );
  await finished(laptop.chats, thread.id, 4);
  const here = (await laptop.chats.get(thread.id)).worktree!;
  // Work in progress, never committed.
  await writeFile(join(here.path!, "CHANGELOG.md"), "- 1.0 First\n");

  expect(await sender.targets(thread.id)).toEqual([
    expect.objectContaining({
      id: computerId,
      online: true,
      project: { id: mini.projectId, name: "App" },
    }),
  ]);
  await sender.handOff(thread.id, computerId);
  await expect(
    laptop.chats.send(thread.id, input("@codex One more thing")),
  ).rejects.toThrow(/This thread is on /);
  await vi.waitFor(async () => {
    const view = await sender.view(thread.id);
    expect(view?.sentTo.error).toBeUndefined();
    expect(view?.sentTo.state).toBe("away");
  });

  // Settings lists it under the computer it went to.
  const overview = await sender.overview();
  expect(overview.computers).toEqual([
    expect.objectContaining({
      id: computerId,
      status: "online",
      threads: [
        expect.objectContaining({
          chatId: thread.id,
          project: "App",
          state: expect.stringMatching(/^(working|finished)$/),
        }),
      ],
    }),
  ]);

  // The note was written here, in the outgoing agent's session, and the work committed.
  const left = await laptop.chats.get(thread.id);
  expect(left.messages.at(-1)).toMatchObject({
    handoff: { from: "codex", to: "codex", computer: expect.any(String) },
    status: "complete",
  });
  expect(git(here.path!, "status", "--porcelain")).toBe("");
  const tip = git(here.path!, "rev-parse", "HEAD");

  // The other computer took it over in a worktree of its own, at the same commit.
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  expect(arrived).toMatchObject({
    title: left.title,
    cameFrom: { carried: left.messages.length, tip },
  });
  const there = arrived!.worktree!;
  expect(git(there.path!, "rev-parse", "HEAD")).toBe(tip);
  expect(await readFile(join(there.path!, "CHANGELOG.md"), "utf8")).toBe(
    "- 1.0 First\n",
  );
  // Its agent carried on at once, briefed with the user's own messages and the note.
  await finished(mini.chats, arrived!.id, left.messages.length + 2);
  const briefed = (await prompts()).at(-1)!;
  expect(briefed).toContain("Carry on with this work");
  expect(briefed).toContain("handed over from another computer");
  expect(briefed).toContain("Add a changelog");
  expect(briefed).toContain("Keep it short, one line per release");
  expect(briefed).toContain("Handoff note from Codex");
  await vi.waitFor(
    async () =>
      expect(await sender.view(thread.id)).toMatchObject({
        online: true,
        remote: { running: false, returned: false },
      }),
    { interval: 500 },
  );

  // More work there, then back.
  await writeFile(
    join(there.path!, "CHANGELOG.md"),
    "- 1.1 Second\n- 1.0 First\n",
  );
  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  expect(await readFile(join(here.path!, "CHANGELOG.md"), "utf8")).toBe(
    "- 1.1 Second\n- 1.0 First\n",
  );
  expect(git(here.path!, "rev-parse", "HEAD")).toBe(
    git(there.path!, "rev-parse", "HEAD"),
  );
  const back = await laptop.chats.get(thread.id);
  expect(back.messages.length).toBeGreaterThan(left.messages.length + 2);
  expect(back.messages.at(-1)?.handoff?.computer).toBeTruthy();
  await vi.waitFor(async () =>
    expect(
      (await mini.chats.get(arrived!.id)).cameFrom?.returnedAt,
    ).toBeTruthy(),
  );
  await expect(
    mini.chats.send(arrived!.id, input("@codex Still here?")),
  ).rejects.toThrow(/went back to/);

  // The next turn here hears what happened there.
  await laptop.chats.send(thread.id, input("@codex What's left?"));
  await finished(laptop.chats, thread.id);
  const resumed = (await prompts()).at(-1)!;
  expect(resumed).toContain("What's left?");
  expect(resumed).toContain("handed over from another computer");
});

/** A worktree thread handed to the mini with CHANGELOG.md in it; the worktrees on both sides. */
async function awayWithChangelog(changelog = true, branch?: string) {
  const paired = await pairedComputers();
  const { laptop, mini, sender, computerId } = paired;
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
    undefined,
    branch,
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  const here = (await laptop.chats.get(thread.id)).worktree!.path!;
  if (changelog) await writeFile(join(here, "CHANGELOG.md"), "- 1.0 First\n");
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await sender.view(thread.id))?.sentTo.state).toBe("away"),
  );
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await finished(mini.chats, arrived!.id);
  const there = arrived!.worktree!.path!;
  const commitHere = async (file: string, text: string) => {
    await writeFile(join(here, file), text);
    git(here, "add", file);
    git(here, "commit", "-qm", `Here: ${file}`);
  };
  return { ...paired, thread, here, there, commitHere };
}

it("replays work that comes back onto a worktree that moved on meanwhile", async () => {
  const { sender, thread, here, there, commitHere } = await awayWithChangelog();
  await commitHere("NOTES.md", "made here\n");
  const made = git(here, "rev-parse", "HEAD");
  await writeFile(join(there, "CHANGELOG.md"), "- 1.1 Second\n- 1.0 First\n");

  await sender.bringBack(thread.id);
  await vi.waitFor(async () => expect(await sender.view(thread.id)).toBeNull());
  expect(await readFile(join(here, "CHANGELOG.md"), "utf8")).toBe(
    "- 1.1 Second\n- 1.0 First\n",
  );
  expect(await readFile(join(here, "NOTES.md"), "utf8")).toBe("made here\n");
  // The returned commits went on top of the one made here, which stays as it was.
  expect(git(here, "rev-list", "--first-parent", "HEAD")).toContain(made);
  expect(
    Number(git(here, "rev-list", "--count", `${made}..HEAD`)),
  ).toBeGreaterThan(0);
  expect(git(here, "rev-list", "--merges", "HEAD")).toBe("");
  expect(git(here, "status", "--porcelain")).toBe("");
  expect(git(here, "for-each-ref", "refs/relay/handoffs/")).toBe("");
});

it("keeps a branch the user named on the other computer, and brings its work back", async () => {
  const { sender, mini, thread, here, there } = await awayWithChangelog(
    true,
    "feature/changelog",
  );
  expect(git(here, "branch", "--show-current")).toBe("feature/changelog");
  expect(git(there, "branch", "--show-current")).toBe("feature/changelog");
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  expect(arrived!.worktree?.named).toBe("feature/changelog");

  await writeFile(join(there, "CHANGELOG.md"), "- 1.1 Second\n- 1.0 First\n");
  await sender.bringBack(thread.id);
  await vi.waitFor(async () => expect(await sender.view(thread.id)).toBeNull());
  expect(await readFile(join(here, "CHANGELOG.md"), "utf8")).toBe(
    "- 1.1 Second\n- 1.0 First\n",
  );
  expect(git(here, "branch", "--show-current")).toBe("feature/changelog");
});

/** A thread on a named branch, there and back again, then handed to the mini a second time. */
async function secondTrip(meanwhile: (there: string) => Promise<void>) {
  const away = await awayWithChangelog(true, "feature/changelog");
  const { sender, laptop, mini, computerId, thread, there } = away;
  await writeFile(join(there, "CHANGELOG.md"), "- 1.1 Second\n- 1.0 First\n");
  await sender.bringBack(thread.id);
  await vi.waitFor(async () => expect(await sender.view(thread.id)).toBeNull());
  // What the first trip left there: its copy, still holding the branch.
  const [first] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await vi.waitFor(async () =>
    expect((await mini.chats.get(first!.id)).cameFrom?.returnedAt).toBeTruthy(),
  );
  expect(git(there, "branch", "--show-current")).toBe("feature/changelog");
  await meanwhile(there);

  await laptop.chats.send(thread.id, input("@codex A date on each line"));
  await finished(laptop.chats, thread.id);
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await sender.view(thread.id))?.sentTo.state).toBe("away"),
  );
  const second = mini.chats
    .list(mini.projectId)
    .find((c) => c.cameFrom && c.id !== first!.id)!;
  const kickoff = [...(await mini.chats.get(second.id)).messages]
    .reverse()
    .find((m) => m.body.includes("Carry on with this work"))!.body;
  return { ...away, first: first!, second, kickoff };
}

it("carries on in the folder and named branch of an earlier trip that went back", async () => {
  const { mini, here, there, first, second, kickoff } = await secondTrip(
    async (there) => {
      // A hand-copied file Git ignores, which a fresh folder wouldn't have.
      const common = git(there, "rev-parse", "--git-common-dir");
      await writeFile(join(common, "info", "exclude"), ".env\n");
      await writeFile(join(there, ".env"), "SECRET=1\n");
    },
  );
  expect(second.worktree).toMatchObject({
    path: there,
    branch: "feature/changelog",
  });
  expect(git(there, "rev-parse", "HEAD")).toBe(git(here, "rev-parse", "HEAD"));
  expect(await readFile(join(there, ".env"), "utf8")).toBe("SECRET=1\n");
  expect((await mini.chats.get(first.id)).worktree?.removedAt).toBeTypeOf(
    "number",
  );
  expect(kickoff).not.toContain("Its branch on this computer");
}, 90000);

it("says why an arriving thread's branch got another name", async () => {
  const { there, second, kickoff } = await secondTrip(async (there) => {
    await writeFile(join(there, "scratch.txt"), "left behind\n");
  });
  expect(second.worktree?.branch).toBe("relay/feature-changelog-2");
  expect(second.worktree?.path).not.toBe(there);
  expect(kickoff).toContain(
    "Its branch on this computer is relay/feature-changelog-2, not feature/changelog:",
  );
  expect(kickoff).toContain("from its last trip here, still holds it");
  expect(kickoff).toContain("uncommitted changes");
}, 90000);

it("brings a thread back with its clashing work set aside, to resolve it there", async () => {
  const { sender, laptop, thread, here, there, commitHere } =
    await awayWithChangelog();
  await commitHere("CHANGELOG.md", "- 1.0 Made here\n");
  await writeFile(join(there, "CHANGELOG.md"), "- 1.0 Made there\n");
  const head = git(here, "rev-parse", "HEAD");

  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await sender.view(thread.id))?.sentTo).toMatchObject({
      state: "returning",
      conflicts: ["CHANGELOG.md"],
    }),
  );
  expect(git(here, "rev-parse", "HEAD")).toBe(head);
  expect(git(here, "status", "--porcelain")).toBe("");

  const { id } = (await laptop.chats.get(thread.id)).sentTo!;
  await sender.bringBack(thread.id, true);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  expect(git(here, "rev-parse", "HEAD")).toBe(head);
  const parked = `refs/relay/handoffs/${id}`;
  expect(git(here, "show", `${parked}:CHANGELOG.md`)).toBe("- 1.0 Made there");
});

it("tells the computer it came from when a turn there fails", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await sender.view(thread.id))?.sentTo.state).toBe("away"),
  );
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await finished(mini.chats, arrived!.id);

  await mini.chats.send(arrived!.id, input("@codex fixture codex crash"));
  await vi.waitFor(async () =>
    expect((await mini.chats.get(arrived!.id)).messages.at(-1)?.status).toBe(
      "failed",
    ),
  );
  await vi.waitFor(
    async () => {
      const view = await sender.view(thread.id);
      expect(view?.remote).toMatchObject({
        running: false,
        failed: expect.any(String),
      });
      expect(view?.remote?.latest).toBeUndefined();
    },
    { interval: 500 },
  );
  const [shown] = (await sender.overview()).computers[0]!.threads;
  expect(shown).toMatchObject({ state: "stopped", error: expect.any(String) });
});

it("brings replies written there back under the messages they answer", async () => {
  const { laptop, mini, sender, thread } = await awayWithChangelog();
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  const before = (await laptop.chats.get(thread.id)).messages;
  const carried = (await mini.chats.get(arrived!.id)).messages.slice(
    0,
    before.length,
  );
  expect(carried[1]!.id).not.toBe(before[1]!.id);

  // A side question on a carried answer, and a main turn with a reply of its own.
  const ask = async (body: string, parentId?: string) => {
    const request = { ...input(body), ...(parentId ? { parentId } : {}) };
    await mini.chats.send(arrived!.id, request);
    await vi.waitFor(async () => {
      const saved = await mini.chats.get(arrived!.id);
      const index = saved.messages.findIndex((m) => m.id === request.id);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(saved.messages[index + 1]?.status).toBe("complete");
    });
    return request.id;
  };
  const sideQuestion = await ask("@codex Why a changelog?", carried[1]!.id);
  const main = await ask("@codex Now a main question");
  const answerIndex = (await mini.chats.get(arrived!.id)).messages.findIndex(
    (m) => m.id === main,
  );
  const mainReply = await ask(
    "@codex About that main answer",
    (await mini.chats.get(arrived!.id)).messages[answerIndex + 1]!.id,
  );

  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  const back = (await laptop.chats.get(thread.id)).messages;
  const find = (id: string) => back.find((m) => m.id === id)!;
  // On the laptop the carried answer has its old id again.
  expect(find(sideQuestion).parentId).toBe(before[1]!.id);
  const mainAnswerId = back[back.findIndex((m) => m.id === main) + 1]!.id;
  expect(find(mainReply).parentId).toBe(mainAnswerId);
  expect(find(main).parentId ?? undefined).toBeUndefined();
}, 90000);

it("keeps the worktree of a thread that hasn't gone back, so it can still be handed back", async () => {
  const { laptop, mini, sender, thread, there } =
    await awayWithChangelog(false);
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  // Nothing changed there, which is when archiving usually drops the worktree.
  await mini.chats.triage(arrived!.id, { kind: "archive" });
  expect(
    (await mini.chats.get(arrived!.id)).worktree!.removedAt,
  ).toBeUndefined();
  await expect(mini.chats.removeWorktree(arrived!.id)).rejects.toThrow(
    /Hand this thread back first/,
  );
  expect(existsSync(there)).toBe(true);

  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  // Back home, the copy there is just an archived thread again.
  await vi.waitFor(async () =>
    expect(
      (await mini.chats.get(arrived!.id)).cameFrom?.returnedAt,
    ).toBeTruthy(),
  );
  await mini.chats.removeWorktree(arrived!.id);
  expect(existsSync(there)).toBe(false);
});

it("hands a thread back whose worktree was deleted there, with the commits its branch kept", async () => {
  const { laptop, mini, sender, thread, here, there } =
    await awayWithChangelog(false);
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await writeFile(join(there, "NOTES.md"), "kept\n");
  git(there, "add", "NOTES.md");
  git(there, "commit", "-qm", "There: notes");
  await writeFile(join(there, "LOST.md"), "never committed\n");
  await rm(there, { recursive: true, force: true });

  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  expect(await readFile(join(here, "NOTES.md"), "utf8")).toBe("kept\n");
  expect(existsSync(join(here, "LOST.md"))).toBe(false);
  expect((await laptop.chats.get(thread.id)).messages.length).toBeGreaterThan(
    2,
  );
  await vi.waitFor(async () =>
    expect(
      (await mini.chats.get(arrived!.id)).cameFrom?.returnedAt,
    ).toBeTruthy(),
  );
});

it("hands a thread back without files when its worktree and branch are both gone there", async () => {
  const { laptop, mini, sender, thread, here, there } =
    await awayWithChangelog(false);
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  const head = git(here, "rev-parse", "HEAD");
  await rm(there, { recursive: true, force: true });
  git(mini.clone, "worktree", "prune");
  git(mini.clone, "branch", "-D", arrived!.worktree!.branch!);

  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  expect(git(here, "rev-parse", "HEAD")).toBe(head);
});

it("refuses a hand-back whose messages are malformed, and changes nothing here", async () => {
  const { laptop, mini, sender, thread, here } = await awayWithChangelog(false);
  const before = (await laptop.chats.get(thread.id)).messages;
  const head = git(here, "rev-parse", "HEAD");
  const real = mini.chats.handBack.bind(mini.chats);
  vi.spyOn(mini.chats, "handBack").mockImplementation(async (id, deviceId) => {
    const back = await real(id, deviceId);
    return {
      ...back,
      messages: [
        ...back.messages,
        { id: "bad", role: "assistant", body: 42, created: 1, version: 1 },
      ] as never,
    };
  });

  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo?.error).toMatch(
      /message \d+'s body/,
    ),
  );
  const after = await laptop.chats.get(thread.id);
  expect(after.sentTo?.state).toBe("returning");
  expect(after.messages).toEqual(before);
  expect(git(here, "rev-parse", "HEAD")).toBe(head);
  expect(git(here, "for-each-ref", "refs/relay/handoffs/")).toBe("");
});

it("takes hand-back messages with a null parent and fields only the other side knows", () => {
  const message = {
    id: "m1",
    role: "assistant",
    body: "Done",
    status: "complete",
    created: 1,
    version: 1,
    provider: "codex",
    parentId: null,
    somethingNewer: { a: 1 },
  };
  expect(handoffMessagesSchema.parse([message])).toEqual([message]);
  expect(
    handoffMessagesSchema.safeParse([{ ...message, status: "?" }]).success,
  ).toBe(false);
});

it("lets the computer it came from peek at what the turn there is doing", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await sender.view(thread.id))?.sentTo.state).toBe("away"),
  );
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await finished(mini.chats, arrived!.id);
  // The turn the mini ran on arrival: its calls and what its agent said.
  const command = {
    kind: "command",
    label: "git diff --stat",
    status: "complete",
  };
  await vi.waitFor(
    async () =>
      expect((await sender.view(thread.id))?.remote).toMatchObject({
        running: false,
        provider: "codex",
        model: "fixture-model",
        says: "I'll inspect the cache guard first.",
        recent: expect.arrayContaining([expect.objectContaining(command)]),
      }),
    { interval: 500 },
  );

  // One that keeps going: running since about now, by this computer's clock.
  const sent = Date.now();
  await mini.chats.send(arrived!.id, input("@codex fixture codex steer"));
  await vi.waitFor(
    async () => {
      const remote = (await sender.view(thread.id))?.remote;
      expect(remote).toMatchObject({
        running: true,
        waiting: false,
        recent: expect.arrayContaining([expect.objectContaining(command)]),
      });
      expect(remote!.runningSince).toBeGreaterThanOrEqual(sent - 1000);
      expect(remote!.runningSince).toBeLessThanOrEqual(Date.now());
    },
    { interval: 500 },
  );
  // The sidebar asks for every away thread at once.
  expect((await sender.views())[thread.id]).toMatchObject({
    sentTo: { state: "away" },
    online: true,
    remote: { running: true },
  });

  await mini.chats.send(arrived!.id, {
    ...input("@codex Use the blue one"),
    delivery: "steer",
  });
  await finished(mini.chats, arrived!.id);
});

it("refuses threads that work in the checkout, and takes nothing from a phone", async () => {
  const { laptop, remote, sender, computerId } = await pairedComputers();
  const thread = await laptop.chats.create(laptop.projectId, {
    kind: "project",
  });
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  await expect(sender.handOff(thread.id, computerId)).rejects.toThrow(
    /own worktree/,
  );
  expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined();

  const link = parsePairingUrl((await remote.pairing()).url)!;
  const phone = new RemoteClient({
    start: { link, device: "Pixel" },
    timeoutMs: 5000,
  });
  cleanup.push(() => phone.close());
  phone.start();
  await vi.waitFor(() => expect(phone.status).toBe("online"));
  await expect(phone.call("computerProjects")).rejects.toThrow(
    "Only a paired computer can do that.",
  );
});

it("carries commits the shared remote never saw, and answers a repeated handoff the same", async () => {
  const { laptop, mini, sender, computers, computerId } =
    await pairedComputers();
  // A commit on the laptop's main that was never pushed; the worktree starts from it.
  await writeFile(join(laptop.clone, "NOTES.md"), "local only\n");
  git(laptop.clone, "add", "-A");
  git(laptop.clone, "commit", "-q", "-m", "Unpushed");
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Tidy the notes"));
  await finished(laptop.chats, thread.id, 2);
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await sender.view(thread.id))?.sentTo).toMatchObject({
      state: "away",
    }),
  );
  const sentTo = (await laptop.chats.get(thread.id)).sentTo!;
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  expect(
    await readFile(join(arrived!.worktree!.path!, "NOTES.md"), "utf8"),
  ).toBe("local only\n");
  // Counted from where the work began, as it was on the laptop.
  expect(arrived!.worktree!.start).toBe(
    (await laptop.chats.get(thread.id)).worktree!.start,
  );
  // A sender that lost the answer asks again and gets the same thread.
  const client = await computers.connected(computerId);
  expect(await client.call("receiveHandoff", sentTo.id)).toMatchObject({
    chatId: arrived!.id,
  });
  expect(
    mini.chats.list(mini.projectId).filter((c) => c.cameFrom),
  ).toHaveLength(1);
});

it("updates the other computer's Relay from here, and tells an older one apart", async () => {
  const { sender, updater, computerId } = await pairedComputers();
  expect((await sender.overview()).computers[0]).toMatchObject({
    version: "0.9.0",
    update: { status: "idle" },
  });
  expect((await sender.overview()).computers[0]!.outdated).toBeUndefined();
  await sender.update(computerId);
  // It checks, then downloads and restarts into the new release on its own.
  await vi.waitFor(() =>
    expect(updater.calls).toEqual(["check", "download", "install"]),
  );
  // A Relay from before bridge 10 can't say, and one from before this one's handoffs can't take threads.
  expect(outdated(null)).toBe(true);
  expect(
    outdated({
      version: "0.8.0",
      bridge: handoffBridge - 1,
      update: { status: "idle", current: "0.8.0" },
    }),
  ).toBe(true);
  expect(
    outdated({
      version: "0.9.0",
      bridge: handoffBridge,
      update: { status: "idle", current: "0.9.0" },
    }),
  ).toBe(false);
});

/** A worktree thread marked as handing off to the mini, with nothing sent: a handoff that got stuck. */
async function stuckSending() {
  const paired = await pairedComputers();
  const { laptop, computers, computerId } = paired;
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  await laptop.chats.markHandoff(thread.id, {
    id: randomUUID(),
    computerId,
    computer: computers.get(computerId).name,
    at: Date.now(),
  });
  return { ...paired, thread };
}

it("keeps a stuck handoff here once the other computer says it never got the thread", async () => {
  const { laptop, sender, thread } = await stuckSending();
  await laptop.chats.updateSentTo(
    thread.id,
    (await laptop.chats.get(thread.id)).sentTo!.id,
    { error: "The link dropped." },
  );
  await sender.keepHere(thread.id);
  expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined();
  await laptop.chats.send(thread.id, input("@codex Carry on here"));
});

it("won't keep a handoff here while the other computer can't be asked", async () => {
  const { laptop, sender, computers, thread } = await stuckSending();
  computers.close();
  await expect(sender.keepHere(thread.id)).rejects.toThrow(
    /Can't tell whether .* got this thread.*take the thread back without/s,
  );
  expect((await laptop.chats.get(thread.id)).sentTo?.state).toBe("sending");
});

it("won't keep a handoff here when the other computer did take the thread", async () => {
  const { laptop, mini, sender, thread } = await awayWithChangelog(false);
  const { id } = (await laptop.chats.get(thread.id)).sentTo!;
  // The answer to `receiveHandoff` got lost, so the laptop still thinks it's sending.
  await laptop.chats.updateSentTo(thread.id, id, {
    state: "sending",
    error: "The link dropped.",
  });
  await expect(sender.keepHere(thread.id)).rejects.toThrow(
    /got this thread after all/,
  );
  expect((await laptop.chats.get(thread.id)).sentTo).toMatchObject({
    state: "away",
  });
  expect(
    mini.chats.list(mini.projectId).filter((c) => c.cameFrom),
  ).toHaveLength(1);
});

it("takes a thread back without the computer that has it, as it was when it left", async () => {
  const { laptop, mini, sender, thread, here, there } =
    await awayWithChangelog();
  const left = await laptop.chats.get(thread.id);
  const { id, computer } = left.sentTo!;
  await writeFile(join(there, "CHANGELOG.md"), "- 1.1 only there\n");
  await expect(
    laptop.chats.send(thread.id, input("@codex Carry on")),
  ).rejects.toThrow(/This thread is on /);

  await sender.abandon(thread.id);

  const after = await laptop.chats.get(thread.id);
  expect(after.sentTo).toBeUndefined();
  expect(after.abandonedHandoffs).toEqual([
    { id, computer, at: expect.any(Number) },
  ]);
  expect(after.messages).toEqual(left.messages);
  expect(await sender.view(thread.id)).toBeNull();
  expect(await readFile(join(here, "CHANGELOG.md"), "utf8")).toBe(
    "- 1.0 First\n",
  );
  // Nothing of what happened there comes along.
  expect(await readFile(join(there, "CHANGELOG.md"), "utf8")).toBe(
    "- 1.1 only there\n",
  );
  expect(
    mini.chats.list(mini.projectId).filter((c) => c.cameFrom),
  ).toHaveLength(1);
  await expect(sender.bringBack(thread.id)).rejects.toThrow(/already here/);
  await laptop.chats.send(thread.id, input("@codex Carry on here"));
  await finished(laptop.chats, thread.id, left.messages.length + 2);
  // Abandoning a thread that's here changes nothing.
  await sender.abandon(thread.id);
  expect((await laptop.chats.get(thread.id)).abandonedHandoffs).toHaveLength(1);
});

it("takes a handoff back that never finished sending", async () => {
  const { laptop, sender, thread } = await stuckSending();
  const { id } = (await laptop.chats.get(thread.id)).sentTo!;
  await sender.abandon(thread.id);
  const after = await laptop.chats.get(thread.id);
  expect(after.sentTo).toBeUndefined();
  expect(after.abandonedHandoffs?.map((a) => a.id)).toEqual([id]);
});

it("tells the other computer a thread was taken back, so its copy is no longer owed and can't be handed back", async () => {
  const { laptop, mini, sender, computers, computerId, thread, there } =
    await awayWithChangelog(false);
  const { id } = (await laptop.chats.get(thread.id)).sentTo!;
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  expect(awaitsReturn(arrived!)).toBe(true);
  await expect(mini.chats.removeWorktree(arrived!.id)).rejects.toThrow(
    /Hand this thread back first/,
  );

  await sender.abandon(thread.id);
  await vi.waitFor(async () =>
    expect(
      (await mini.chats.get(arrived!.id)).cameFrom?.abandonedAt,
    ).toBeTruthy(),
  );
  expect(awaitsReturn(await mini.chats.get(arrived!.id))).toBe(false);
  expect(computers.get(computerId).abandoned).toBeUndefined();

  // Asked for it anyway, the other computer refuses and keeps its work.
  const client = await computers.connected(computerId);
  await expect(client.call("handBack", id)).rejects.toThrow(
    /took this thread back without this computer/,
  );
  await expect(client.call("handedBack", id)).resolves.toBeFalsy();
  expect(
    (await mini.chats.get(arrived!.id)).cameFrom?.returnedAt,
  ).toBeUndefined();

  // Its copy carries on as a thread of its own, and its worktree goes like any other.
  await mini.chats.send(arrived!.id, input("@codex Carry on on the mini"));
  await finished(mini.chats, arrived!.id);
  await mini.chats.removeWorktree(arrived!.id);
  expect(existsSync(there)).toBe(false);
});

it("tells a computer that was offline when the thread was taken back once it's online again", async () => {
  const { laptop, mini, sender, computers, computerId, thread } =
    await awayWithChangelog(false);
  const { id } = (await laptop.chats.get(thread.id)).sentTo!;
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  // The mini drops off the network.
  computers.close();

  await sender.abandon(thread.id);
  expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined();
  await vi.waitFor(() =>
    expect(computers.get(computerId).abandoned).toEqual([id]),
  );
  expect(
    (await mini.chats.get(arrived!.id)).cameFrom?.abandonedAt,
  ).toBeUndefined();

  await computers.start();
  await vi.waitFor(
    async () =>
      expect(
        (await mini.chats.get(arrived!.id)).cameFrom?.abandonedAt,
      ).toBeTruthy(),
    { timeout: 30000 },
  );
  await vi.waitFor(() =>
    expect(computers.get(computerId).abandoned).toBeUndefined(),
  );
}, 90000);

it("drops a notice the other computer is too old to understand instead of sending it forever", async () => {
  const { laptop, sender, computers, computerId, thread } =
    await awayWithChangelog(false);
  const client = await computers.connected(computerId);
  vi.spyOn(client, "call").mockImplementation((async (method: string) => {
    if (method === "handoffAbandoned")
      throw new Error("Computers can't do that.");
  }) as never);
  await sender.abandon(thread.id);
  await vi.waitFor(() =>
    expect(computers.get(computerId).abandoned).toBeUndefined(),
  );
  expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined();
});

it("leaves nothing owed on the other computer when the thread is taken back mid-transfer", async () => {
  const { laptop, mini, sender, computers, computerId } =
    await pairedComputers();
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  const client = await computers.connected(computerId);
  const real = client.call.bind(client) as (
    ...a: unknown[]
  ) => Promise<unknown>;
  let arrival: Promise<unknown> | undefined;
  vi.spyOn(client, "call").mockImplementation((async (
    method: string,
    ...args: unknown[]
  ) => {
    // The user gives up just as the last call goes out, and the mini hears it first.
    if (method === "receiveHandoff") {
      await sender.abandon(thread.id);
      await vi.waitFor(() =>
        expect(computers.get(computerId).abandoned).toBeUndefined(),
      );
      return (arrival = real(method, ...args));
    }
    return real(method, ...args);
  }) as never);

  await sender.handOff(thread.id, computerId);
  await vi.waitFor(() => expect(arrival).toBeDefined());
  // Its upload was dropped with the notice, so there's nothing to take over.
  await expect(arrival).rejects.toThrow();
  const after = await laptop.chats.get(thread.id);
  expect(after.sentTo).toBeUndefined();
  expect(after.abandonedHandoffs).toHaveLength(1);
  expect(mini.chats.list(mini.projectId).filter((c) => c.cameFrom)).toEqual([]);
});
