import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
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
import { ProjectAdding } from "../project-add";
import { savePaste, setPastesRoot } from "../drafts";
import type { ChatMessage } from "../../shared/projects";
import type { NewsItem } from "../../shared/thread-news";

type ChatEvent = Parameters<ConstructorParameters<typeof ProjectChats>[3]>[0];
import { HandoffReceiver } from "./receiver";
import { Handoffs, outdated } from "./sender";
import { RemoteProjects } from "./remote-projects";
import { ThreadTerminals, threadTerminals } from "../terminal/thread-terminals";
import { draftTerminalKey, type TerminalEvent } from "../../shared/terminals";
import { awaitsReturn } from "../project-chats/handoff";
import { liveHandoffBridge, setupBridge } from "../../shared/remote";
import { handoffMessagesSchema } from "../../shared/handoff";
import { workspaceId } from "../../shared/workspaces";
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
  // Nothing here needs a turn to last; at the fixture's 300 ms the file took
  // half a minute longer.
  vi.stubEnv("RELAY_AGENT_TURN_MS", "20");
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

// The sender reuses the other computer's answers for a few seconds; waiting
// that out made every test here seconds slower.
const askEveryTime = { statusMs: 0, infoMs: 0 };

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
  const pushes: { to?: (event: ChatEvent) => void } = {};
  const chats = new ProjectChats(store, projects, join(dir, "chats"), (e) =>
    pushes.to?.(e),
  );
  cleanup.push(() => chats.dispose());
  return { dir, clone, store, projects, projectId, chats, pushes };
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
        pastes: join(mini.dir, "pastes"),
        version: () => "0.9.0",
        updates: updater,
        adding: new ProjectAdding({
          store: mini.store,
          projects: mini.projects,
          client: () => null,
          sessions: undefined as never,
          appData: join(mini.dir, "app-data"),
          send: () => {},
        }),
        // What a live handoff's computer has run here, as the app's dispatch would.
        dispatch: async (method, args) => {
          const [id, ...rest] = args as [string, ...unknown[]];
          if (method === "sendProjectChat")
            return mini.chats.sendYours(id, rest[0] as never);
          if (method === "respondProjectChat")
            return mini.chats.respond(id, rest[0] as string, rest[1] as never);
          if (method === "cancelProjectChat") return mini.chats.cancel(id);
          if (method === "createScratch")
            return mini.projects.scratch(join(mini.dir, "scratch"), () => false);
          if (method === "projectWorkingTree" || method === "threadElsewhere")
            return { ran: method, on: id };
          throw new Error(`Not in this test: ${method}`);
        },
      }),
    },
    0,
    async () => ({ status: "connected", addresses: ["127.0.0.1"] }),
  );
  await remote.setEnabled(true);
  cleanup.push(() => remote.close());
  // As the app wires them: what's written and what runs, out to paired devices.
  mini.pushes.to = (event) => remote.chatEvent(event);
  mini.chats.onSummaries((projectId) =>
    remote.chatsEvent({ projectId, chats: mini.chats.list(projectId) }),
  );
  mini.chats.onNews((item) => remote.news(item));
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
    askEveryTime,
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
  // What it left with; everything after mirrors what the mini writes.
  left.messages = left.messages.slice(0, left.sentTo!.kept);
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
  // The kickoff goes out after the thread lands, and the history it carried
  // already holds the first trip's, worded the same: wait for the new one.
  const kickoff = await vi.waitFor(async () => {
    const { messages, cameFrom } = await mini.chats.get(second.id);
    const body = messages
      .slice(cameFrom!.carried)
      .find((m) => m.body.includes("Carry on with this work"))?.body;
    expect(body).toBeDefined();
    return body!;
  });
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

/** A thread handed off live, once the mini has answered on arrival. */
async function liveThread() {
  const paired = await pairedComputers();
  const { laptop, mini, sender, computerId } = paired;
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toMatchObject({
      state: "away",
      live: true,
    }),
  );
  const kept = (await laptop.chats.get(thread.id)).sentTo!.kept!;
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await finished(mini.chats, arrived!.id);
  return { ...paired, thread, kept, there: arrived!.id };
}

/** What the mini wrote since the thread arrived, as the laptop should mirror it. */
async function writtenThere(mini: { chats: ProjectChats }, id: string) {
  const chat = await mini.chats.get(id);
  return chat.messages
    .slice(chat.cameFrom!.carried)
    .map((m: ChatMessage) => ({ id: m.id, body: m.body, status: m.status }));
}

async function mirrored(chats: ProjectChats, id: string, kept: number) {
  return (await chats.get(id)).messages
    .slice(kept)
    .map((m) => ({ id: m.id, body: m.body, status: m.status }));
}

it("keeps a live handoff's thread here as the other computer writes it, and runs what's sent from here there", async () => {
  const { laptop, mini, sender, thread, kept, there } = await liveThread();
  await vi.waitFor(async () =>
    expect(await mirrored(laptop.chats, thread.id, kept)).toEqual(
      await writtenThere(mini, there),
    ),
  );
  // The prompt that started it there stands as the note's row, not as a message.
  expect((await laptop.chats.get(thread.id)).messages[kept]).toMatchObject({
    role: "user",
    handedOver: true,
  });

  const told: NewsItem[] = [];
  laptop.chats.onNews((item) => told.push(item));
  setPastesRoot(join(laptop.dir, "pastes"));
  const paste = await savePaste("A large log\n".repeat(4000), 1);
  const more = input(`@codex One more thing: \`${paste}\``);
  expect(sender.forwards("sendProjectChat", [thread.id, more])).toBe(true);
  expect(sender.forwards("renameProjectChat", [thread.id, "x"])).toBe(false);
  await sender.forward("sendProjectChat", [thread.id, more]);
  await finished(mini.chats, there);
  expect((await prompts()).at(-1)).toContain("One more thing");
  const remotePaste = (await mini.chats.get(there)).messages
    .find((m) => m.id === more.id)!
    .body.match(/`([^`]+)`/)![1]!;
  expect(remotePaste.startsWith(join(mini.dir, "pastes"))).toBe(true);
  expect(await readFile(remotePaste, "utf8")).toBe(
    await readFile(paste, "utf8"),
  );
  await finished(laptop.chats, thread.id);
  await vi.waitFor(async () =>
    expect(await mirrored(laptop.chats, thread.id, kept)).toEqual(
      (await writtenThere(mini, there)).map((m) => ({
        ...m,
        body: m.body.replaceAll(remotePaste, paste),
      })),
    ),
  );
  // Its answer finished there; the sounds here hear of it, by this thread.
  await vi.waitFor(() =>
    expect(told).toEqual([
      expect.objectContaining({
        kind: "finished",
        chatId: thread.id,
        projectId: laptop.projectId,
      }),
    ]),
  );
  // Saved too, not only held in memory.
  const saved = JSON.parse(
    await readFile(join(laptop.dir, "chats", `${thread.id}.json`), "utf8"),
  ) as { messages: ChatMessage[] };
  expect(saved.messages.at(-1)?.body).toBe(
    (await mini.chats.get(there)).messages.at(-1)?.body,
  );

  // Back here: the thread as it came back, nothing twice.
  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  const back = (await laptop.chats.get(thread.id)).messages;
  expect(new Set(back.map((m) => m.id)).size).toBe(back.length);
  expect(back.filter((m) => m.body.includes("One more thing"))).toHaveLength(1);
});

it("tells once here that a live handoff's thread needs you, as the other computer said", async () => {
  const { laptop, thread } = await liveThread();
  const told: NewsItem[] = [];
  laptop.chats.onNews((item) => told.push(item));
  // What the other computer sends when its agent asks: the live state, then its news.
  laptop.chats.setHandoffLive(thread.id, { running: true, waiting: true });
  laptop.chats.handoffNews(thread.id, laptop.projectId, {
    kind: "waiting",
    title: thread.title,
    body: "Codex needs you",
  });
  await vi.waitFor(() =>
    expect(
      laptop.chats.list(laptop.projectId).find((c) => c.id === thread.id)
        ?.waiting,
    ).toBe(true),
  );
  // Waiting is told as it happens, never read off the list: here only by the other computer.
  expect(told.map((i) => [i.kind, i.chatId])).toEqual([["waiting", thread.id]]);
});

/** A new thread started on the mini, its first answer written there and mirrored here. */
async function startedThread(withPaste = false) {
  const paired = await pairedComputers();
  const { laptop, mini, sender, computerId } = paired;
  const thread = await laptop.chats.create(
    laptop.projectId,
    { kind: "project" },
    "worktree",
  );
  setPastesRoot(join(laptop.dir, "pastes"));
  const paste = withPaste
    ? await savePaste("initial log\n".repeat(4000), 1)
    : undefined;
  const first = input(
    `@codex Add a changelog${paste ? ` using \`${paste}\`` : ""}`,
  );
  await laptop.chats.firstMessageOnly(thread.id, first);
  const kept = await laptop.chats.get(thread.id);
  expect(kept.messages.map((m) => m.id)).toEqual([first.id]);
  expect(kept.worktree?.path).toBeTruthy();
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toMatchObject({
      state: "away",
      live: true,
      kept: 0,
      start: true,
    }),
  );
  const [arrived] = mini.chats.list(mini.projectId).filter((c) => c.cameFrom);
  await finished(mini.chats, arrived!.id);
  const there = await mini.chats.get(arrived!.id);
  // Here the first message is the one that came back, never twice.
  await vi.waitFor(async () =>
    expect(
      (await laptop.chats.get(thread.id)).messages.map((m) => m.id),
    ).toEqual(there.messages.map((m) => m.id)),
  );
  return { ...paired, thread, first, there, paste };
}

it("starts a new thread on the other computer with its first message, answered only there", async () => {
  const { first, there, paste, mini } = await startedThread(true);
  // Its own words as the first turn, not a note to carry on from.
  const prompt = (await prompts()).at(-1)!;
  expect(prompt).toContain("Add a changelog");
  expect(prompt).not.toContain("handed over");
  expect(there.messages[0]).toMatchObject({ id: first.id, role: "user" });
  expect(there.messages[0]!.handedOver).toBeUndefined();
  expect(there.messages.at(-1)).toMatchObject({ role: "assistant" });
  const remotePaste = there.messages[0]!.body.match(/`([^`]+)`/)![1]!;
  expect(remotePaste.startsWith(join(mini.dir, "pastes"))).toBe(true);
  expect(await readFile(remotePaste, "utf8")).toBe(
    await readFile(paste!, "utf8"),
  );
  expect(prompt).toContain(remotePaste);
});

it("keeps a started thread's first message when it's taken back without the other computer", async () => {
  const { laptop, mini, sender, thread, first, there } = await startedThread();
  const answered = (await laptop.chats.get(thread.id)).messages;
  expect(answered.length).toBeGreaterThan(1);
  await sender.abandon(thread.id);
  const back = await laptop.chats.get(thread.id);
  expect(back.sentTo).toBeUndefined();
  // What the mini answered goes with it; what was sent from here stays.
  expect(back.messages).toEqual([
    expect.objectContaining({ id: first.id, role: "user", body: first.body }),
  ]);
  expect(back.abandonedHandoffs).toHaveLength(1);
  await vi.waitFor(async () =>
    expect((await mini.chats.get(there.id)).cameFrom?.abandonedAt).toBeTruthy(),
  );
});

it("runs a live handoff's folder calls on the other computer's worktree, and won't open the copy left here", async () => {
  const { laptop, mini, sender, thread, there } = await liveThread();
  const { sentTo } = await laptop.chats.get(thread.id);
  expect(sentTo).toMatchObject({ folder: true });
  const where = workspaceId(laptop.projectId, thread.id);
  const here = () => "here";
  expect(sender.forwards("projectWorkingTree", [where])).toBe(true);
  expect(await sender.forward("projectWorkingTree", [where], here)).toEqual({
    ran: "projectWorkingTree",
    on: workspaceId(mini.projectId, there),
  });
  // An agent's own worktree beside the thread's never went across.
  expect(
    sender.forwards("projectWorkingTree", [
      workspaceId(laptop.projectId, thread.id, "/elsewhere"),
    ]),
  ).toBe(false);
  expect(sender.forwards("projectWorkingTree", [laptop.projectId])).toBe(false);
  // What its agents changed in other repositories is on that computer too.
  expect(await sender.forward("threadElsewhere", [thread.id], here)).toEqual({
    ran: "threadElsewhere",
    on: there,
  });
  await expect(
    sender.forward("revealProjectPath", [where, ""]),
  ).rejects.toThrow(`This thread's files are on ${sentTo!.computer};`);
  // Handed to a Relay too old for folder calls, they read the copy here.
  await laptop.chats.updateSentTo(thread.id, sentTo!.id, { folder: undefined });
  expect(await sender.forward("projectWorkingTree", [where], here)).toBe(
    "here",
  );
});

it("hands a thread straight back out with the note that came back, not one from an agent that never saw that work", async () => {
  const { laptop, mini, sender, thread, computerId } = await liveThread();
  await sender.bringBack(thread.id);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toBeUndefined(),
  );
  const back = (await laptop.chats.get(thread.id)).messages;
  const returned = back.at(-1)!;
  expect(returned.handoff?.computer).toBeTruthy();
  const turns = (await prompts()).length;
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toMatchObject({
      state: "away",
    }),
  );
  const out = await laptop.chats.get(thread.id);
  const passed = out.messages[back.length]!;
  expect(passed.id).not.toBe(returned.id);
  expect(passed).toMatchObject({
    body: returned.body,
    handoff: { computer: out.sentTo!.computer },
  });
  // The only new turn is the one that carries on there.
  const [again] = mini.chats
    .list(mini.projectId)
    .filter((c) => c.cameFrom?.id === out.sentTo!.id);
  await finished(mini.chats, again!.id);
  expect((await prompts()).length).toBe(turns + 1);
  expect((await mini.chats.get(again!.id)).messages.at(-1)?.status).toBe(
    "complete",
  );
});

it("shows what runs and waits on the other computer, and answers and stops it from here", async () => {
  const { laptop, mini, sender, thread, there } = await liveThread();
  await sender.forward("sendProjectChat", [
    thread.id,
    input("@codex fixture request approval"),
  ]);
  await vi.waitFor(async () => {
    expect((await laptop.chats.get(thread.id)).requests).toHaveLength(1);
    expect(
      laptop.chats.list(laptop.projectId).find((c) => c.id === thread.id),
    ).toMatchObject({ running: true, blocked: true });
  });
  const [request] = (await laptop.chats.get(thread.id)).requests!;
  expect(request!.id).toBe((await mini.chats.get(there)).requests![0]!.id);
  await sender.forward("respondProjectChat", [
    thread.id,
    request!.id,
    { kind: "approval", decision: "accept" },
  ]);
  await finished(laptop.chats, thread.id);
  expect((await laptop.chats.get(thread.id)).requests).toEqual([]);

  await sender.forward("sendProjectChat", [
    thread.id,
    input("@codex fixture codex steer"),
  ]);
  await vi.waitFor(() =>
    expect(
      laptop.chats.list(laptop.projectId).find((c) => c.id === thread.id)
        ?.running,
    ).toBe(true),
  );
  await sender.forward("cancelProjectChat", [thread.id]);
  await vi.waitFor(() =>
    expect(
      mini.chats.list(mini.projectId).find((c) => c.id === there)?.running,
    ).toBeFalsy(),
  );
  await vi.waitFor(() =>
    expect(
      laptop.chats.list(laptop.projectId).find((c) => c.id === thread.id)
        ?.running,
    ).toBeFalsy(),
  );
});

it("catches up on what a live handoff wrote while the computers were apart, without doubling any", async () => {
  const { laptop, mini, computers, thread, kept, there } = await liveThread();
  computers.close();
  await mini.chats.send(there, input("@codex Written while apart"));
  await finished(mini.chats, there);

  const again = new Computers(
    laptop.store,
    async (v) => "sealed:" + v,
    async (v) => v.slice(7),
    { timeoutMs: 5000 },
  );
  cleanup.push(() => again.close());
  new Handoffs(
    laptop.store,
    again,
    laptop.chats,
    laptop.projects,
    join(laptop.dir, "handoffs"),
    askEveryTime,
  );
  await again.start();
  await vi.waitFor(async () =>
    expect(await mirrored(laptop.chats, thread.id, kept)).toEqual(
      await writtenThere(mini, there),
    ),
  );
  expect(
    (await mirrored(laptop.chats, thread.id, kept)).filter((m) =>
      m.body.includes("Written while apart"),
    ),
  ).toHaveLength(1);
});

it("holds what's sent while a live thread's computer is away, and sends it once it's back", async () => {
  const { laptop, mini, sender, computers, thread, kept, there } =
    await liveThread();
  computers.close();
  setPastesRoot(join(laptop.dir, "pastes"));
  const paste = await savePaste("offline log\n".repeat(4000), 1);
  const later = input(`@codex Sent while apart: \`${paste}\``);
  await sender.forward("sendProjectChat", [thread.id, later]);
  expect((await laptop.chats.get(thread.id)).outbox).toMatchObject([
    { input: { id: later.id } },
  ]);

  const again = new Computers(
    laptop.store,
    async (v) => "sealed:" + v,
    async (v) => v.slice(7),
    { timeoutMs: 5000 },
  );
  cleanup.push(() => again.close());
  new Handoffs(
    laptop.store,
    again,
    laptop.chats,
    laptop.projects,
    join(laptop.dir, "handoffs"),
    askEveryTime,
  );
  await again.start();
  await vi.waitFor(async () =>
    expect(
      (await mini.chats.get(there)).messages.filter((m) => m.id === later.id),
    ).toHaveLength(1),
  );
  await finished(mini.chats, there);
  const remotePaste = (await mini.chats.get(there)).messages
    .find((m) => m.id === later.id)!
    .body.match(/`([^`]+)`/)![1]!;
  expect(remotePaste.startsWith(join(mini.dir, "pastes"))).toBe(true);
  expect(await readFile(remotePaste, "utf8")).toBe(
    await readFile(paste, "utf8"),
  );
  await vi.waitFor(async () => {
    expect((await laptop.chats.get(thread.id)).outbox).toBeUndefined();
    expect(await mirrored(laptop.chats, thread.id, kept)).toEqual(
      (await writtenThere(mini, there)).map((m) => ({
        ...m,
        body: m.body.replaceAll(remotePaste, paste),
      })),
    );
  });
});

it("carries a live thread on here while its computer is away, with what waited, and tells the agent the code stayed there", async () => {
  const { laptop, mini, sender, computers, thread, kept, there } =
    await liveThread();
  await vi.waitFor(async () =>
    expect(await mirrored(laptop.chats, thread.id, kept)).toEqual(
      await writtenThere(mini, there),
    ),
  );
  await expect(sender.runHere(thread.id)).rejects.toThrow(/is back/);
  const before = (await laptop.chats.get(thread.id)).messages;
  computers.close();
  const waiting = input("@codex Carry on without the mini");
  await sender.forward("sendProjectChat", [thread.id, waiting]);
  await sender.runHere(thread.id);

  const chat = await laptop.chats.get(thread.id);
  expect(chat.sentTo).toBeUndefined();
  expect(chat.outbox).toBeUndefined();
  // The conversation from there stays.
  expect(chat.messages.slice(0, before.length).map((m) => m.id)).toEqual(
    before.map((m) => m.id),
  );
  expect(chat.abandonedHandoffs?.at(-1)?.ranHere?.after).toBe(
    before.at(-1)!.id,
  );
  await finished(laptop.chats, thread.id, before.length + 2);
  const prompt = (await prompts()).at(-1);
  expect(prompt).toContain("Carry on without the mini");
  expect(prompt).toMatch(/changed in the code is in this checkout/);
});

it("puts back what fails to go out here, with what came after it, and sends it once asked again", async () => {
  const { laptop, mini, sender, computers, thread, kept, there } =
    await liveThread();
  await vi.waitFor(async () =>
    expect(await mirrored(laptop.chats, thread.id, kept)).toEqual(
      await writtenThere(mini, there),
    ),
  );
  const before = (await laptop.chats.get(thread.id)).messages.length;
  computers.close();
  const empty = input("@codex");
  const next = input("@codex Then this one");
  await sender.forward("sendProjectChat", [thread.id, empty]);
  await sender.forward("sendProjectChat", [thread.id, next]);
  await sender.runHere(thread.id);

  let chat = await laptop.chats.get(thread.id);
  expect(chat.sentTo).toBeUndefined();
  expect(chat.messages).toHaveLength(before);
  expect(chat.outbox).toMatchObject([
    {
      input: { id: empty.id },
      error: "Add a question after the agent mention.",
    },
    { input: { id: next.id } },
  ]);
  expect(chat.outbox![1]!.error).toBeUndefined();

  await sender.dropHeld(thread.id, empty.id);
  await sender.runHere(thread.id);
  await finished(laptop.chats, thread.id, before + 2);
  chat = await laptop.chats.get(thread.id);
  expect(chat.outbox).toBeUndefined();
  expect(chat.messages.at(-2)).toMatchObject({ id: next.id, body: next.body });
});

/**
 * A project of the laptop's that the mini lacks, behind a URL as the mini
 * clones only those, served from disk. `reachable` false takes its remote
 * away, as a missing sign-in would.
 */
async function lackedProject(laptop: Awaited<ReturnType<typeof computer>>) {
  vi.stubEnv("GIT_CONFIG_COUNT", "1");
  vi.stubEnv("GIT_CONFIG_KEY_0", `url.${join(root, "remote")}/.insteadOf`);
  vi.stubEnv("GIT_CONFIG_VALUE_0", "https://git.example.test/");
  const url = "https://git.example.test/me/tool.git";
  const origin = join(root, "remote", "me", "tool.git");
  await mkdir(origin, { recursive: true });
  git(origin, "init", "--bare", "-q", "-b", "main");
  const tool = join(laptop.dir, "tool");
  git(laptop.dir, "clone", "-q", url, tool);
  await writeFile(join(tool, "README.md"), "# Tool\n");
  git(tool, "add", "-A");
  git(tool, "commit", "-q", "-m", "First");
  git(tool, "push", "-q", "origin", "HEAD:main");
  const hidden = join(root, "hidden-tool.git");
  return {
    url,
    projectId: (await laptop.projects.add(tool, null)).id,
    reachable: async (on: boolean) =>
      on
        ? await rename(hidden, origin)
        : await rename(origin, hidden),
  };
}

/** A new thread in the project, started on the mini with its first message. */
async function startOnMini(
  laptop: Awaited<ReturnType<typeof computer>>,
  sender: Handoffs,
  computerId: string,
  projectId: string,
) {
  const thread = await laptop.chats.create(
    projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.firstMessageOnly(thread.id, input("@codex Add a changelog"));
  await sender.handOff(thread.id, computerId);
  return thread.id;
}

it("starts a thread on a computer that lacks its project by cloning it there first", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const { projectId } = await lackedProject(laptop);
  const [target] = await sender.startTargets(projectId);
  expect(target).toMatchObject({
    clone: "me/tool",
    problem: expect.stringMatching(/^Not cloned on /),
  });
  expect(target!.project).toBeUndefined();

  const id = await startOnMini(laptop, sender, computerId, projectId);
  await vi.waitFor(async () =>
    expect((await sender.view(id))?.sentTo).toMatchObject({ state: "away" }),
  );
  const there = (await mini.projects.list(null)).find(
    (p) => p.path === join(mini.dir, "tool"),
  );
  expect(there).toBeTruthy();
  const chat = await laptop.chats.get(id);
  // Folded to one line under the first message: no agent was needed.
  expect(chat.setup).toMatchObject({
    state: "done",
    after: 1,
    messages: [],
    folder: expect.stringMatching(/tool$/),
  });
  const [arrived] = mini.chats.list(there!.id).filter((c) => c.cameFrom);
  expect(arrived).toBeTruthy();
});

it("has an agent there set up a project it couldn't clone, answered from the thread, then starts the thread in it", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const { url, projectId, reachable } = await lackedProject(laptop);
  await reachable(false);
  const id = await startOnMini(laptop, sender, computerId, projectId);

  // The clone failed, so an agent on the mini works on it in a thread of its own.
  await vi.waitFor(async () => {
    const chat = await laptop.chats.get(id);
    expect(chat.sentTo?.setup).toBeTruthy();
    expect(chat.setup?.state).toBe("agent");
    expect(chat.setup?.messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "complete",
    });
  });
  let chat = await laptop.chats.get(id);
  const setup = mini.chats.handedOver(chat.sentTo!.setup!)!;
  expect(mini.projects.get(setup.projectId).scratch).toBe(true);
  // What Relay asked comes first; it went to the agent there, not here.
  expect(chat.setup!.messages[0]).toMatchObject({ role: "user" });
  expect(chat.setup!.messages[0]!.body).toContain(url);
  expect(chat.setup!.messages[0]!.body).toContain(join(mini.dir, "tool"));
  expect(chat.messages).toHaveLength(1);
  expect(chat.setup!.error).toBeTruthy();
  // The sidebar reads the thread as that agent stands: here, waiting on the user.
  laptop.chats.setHandoffLive(id, { blocked: true, waiting: true });
  expect(laptop.chats.list(projectId).find((c) => c.id === id)).toMatchObject({
    blocked: true,
    waiting: true,
  });

  // The composer answers that agent; the thread's own folder and messages stay here.
  const answer = input("@codex Done, I signed in");
  expect(sender.forwards("sendProjectChat", [id, answer])).toBe(true);
  expect(sender.forwards("cancelProjectChat", [id])).toBe(true);
  expect(sender.forwards("projectChatContext", [id])).toBe(false);
  expect(sender.forwards("compactProjectChat", [id])).toBe(false);
  expect(
    sender.forwards("projectWorkingTree", [workspaceId(projectId, id)]),
  ).toBe(false);
  // A folder holding no clone of it is turned down.
  expect(await sender.setupFolder(id, join(root, "nowhere"))).toBe(false);

  // Signed in there, the agent clones it where it was told to.
  await reachable(true);
  git(mini.dir, "clone", "-q", url, join(mini.dir, "tool"));
  await sender.forward("sendProjectChat", [id, answer]);
  await vi.waitFor(
    async () =>
      expect((await sender.view(id))?.sentTo).toMatchObject({ state: "away" }),
    { timeout: 10_000 },
  );
  chat = await laptop.chats.get(id);
  expect(chat.sentTo!.setup).toBeUndefined();
  expect(chat.setup).toMatchObject({ state: "done", after: 1 });
  expect(chat.setup!.messages.map((m) => m.body)).toContain(answer.body);
  const there = (await mini.projects.list(null)).find(
    (p) => p.path === join(mini.dir, "tool"),
  )!;
  expect(mini.chats.list(there.id).filter((c) => c.cameFrom)).toHaveLength(1);
  await vi.waitFor(() =>
    expect(
      mini.chats.handedOver(setup.cameFrom!.id)?.cameFrom?.returnedAt,
    ).toBeTruthy(),
  );
});

it("stops a thread's running turn here as soon as it waits on a setup there", async () => {
  const { laptop, sender, computerId } = await pairedComputers();
  const { projectId, reachable } = await lackedProject(laptop);
  await reachable(false);
  const thread = await laptop.chats.create(
    projectId,
    { kind: "project" },
    "worktree",
  );
  await laptop.chats.send(thread.id, input("@codex Add a changelog"));
  await finished(laptop.chats, thread.id, 2);
  // A turn that would outlast the test, still running as the thread goes.
  vi.stubEnv("RELAY_AGENT_TURN_MS", "60000");
  await laptop.chats.send(thread.id, input("@codex Now the release notes"));
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).messages.at(-1)).toMatchObject({
      role: "assistant",
      status: "streaming",
    }),
  );
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).setup?.state).toBe("agent"),
  );
  const chat = await laptop.chats.get(thread.id);
  // Stopped here; what still runs is the setup's agent there.
  expect(chat.messages.at(-1)).toMatchObject({ status: "cancelled" });
});

it("tells a Relay too old to set a project up apart from a failed clone, and ends that setup", async () => {
  const { laptop, sender, computerId } = await pairedComputers();
  const { projectId, reachable } = await lackedProject(laptop);
  await reachable(false);
  vi.spyOn(
    sender as never as { info: () => unknown },
    "info",
  ).mockResolvedValue({
    version: "0.17.0",
    bridge: setupBridge - 1,
    update: { status: "idle", current: "0.17.0" },
  });
  const id = await startOnMini(laptop, sender, computerId, projectId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(id)).sentTo?.error).toMatch(
      /runs an older Relay, which can't set the project up itself/,
    ),
  );
  const chat = await laptop.chats.get(id);
  expect(chat.sentTo!.setup).toBeUndefined();
  expect(chat.setup).toMatchObject({ state: "dropped" });
  expect(chat.setup!.error).toMatch(/older Relay/);
});

it("has threads waiting on the same project there share one setup, and lets one go without the other", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const { url, projectId, reachable } = await lackedProject(laptop);
  await reachable(false);
  const first = await startOnMini(laptop, sender, computerId, projectId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(first)).setup?.state).toBe("agent"),
  );
  const setup = (await laptop.chats.get(first)).sentTo!.setup!;
  const second = await startOnMini(laptop, sender, computerId, projectId);
  const third = await startOnMini(laptop, sender, computerId, projectId);
  await vi.waitFor(async () => {
    for (const id of [second, third]) {
      const chat = await laptop.chats.get(id);
      expect(chat.sentTo?.setup).toBe(setup);
      expect(chat.setup?.messages[0]?.role).toBe("user");
    }
  });
  const setups = (await mini.projects.list(null))
    .filter((p) => p.scratch)
    .flatMap((p) => mini.chats.list(p.id).filter((c) => c.cameFrom));
  expect(setups).toHaveLength(1);

  // One gives up; the setup goes on for the others.
  await sender.abandon(third);
  expect((await laptop.chats.get(third)).sentTo).toBeUndefined();
  expect(mini.chats.handedOver(setup)?.cameFrom?.abandonedAt).toBeUndefined();

  await reachable(true);
  git(mini.dir, "clone", "-q", url, join(mini.dir, "tool"));
  await sender.forward("sendProjectChat", [first, input("@codex Done")]);
  await vi.waitFor(
    async () => {
      for (const id of [first, second])
        expect((await sender.view(id))?.sentTo).toMatchObject({
          state: "away",
        });
    },
    { timeout: 20_000 },
  );
});

it("starts a thread here instead when its setup there is given up on", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const { projectId, reachable } = await lackedProject(laptop);
  await reachable(false);
  // The setup's agent is still at it when it's given up on.
  vi.stubEnv("RELAY_AGENT_TURN_MS", "60000");
  const id = await startOnMini(laptop, sender, computerId, projectId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(id)).setup?.state).toBe("agent"),
  );
  const setupId = (await laptop.chats.get(id)).sentTo!.setup!;
  const setupChat = () => mini.chats.get(mini.chats.handedOver(setupId)!.id);
  await vi.waitFor(async () =>
    expect((await setupChat()).messages.at(-1)?.status).toBe("streaming"),
  );
  vi.stubEnv("RELAY_AGENT_TURN_MS", "300");

  await sender.startHere(id);
  const chat = await laptop.chats.get(id);
  expect(chat.sentTo).toBeUndefined();
  expect(chat.setup?.state).toBe("dropped");
  // The agent there is let go and stops, and the first message is answered here.
  await vi.waitFor(async () => {
    expect(mini.chats.handedOver(setupId)?.cameFrom?.abandonedAt).toBeTruthy();
    expect((await setupChat()).messages.at(-1)?.status).toBe("cancelled");
  });
  await finished(laptop.chats, id, 2);
});

it("starts no setup for a thread taken back while its clone was under way", async () => {
  const { laptop, mini, sender, computerId } = await pairedComputers();
  const { projectId } = await lackedProject(laptop);
  let fail!: (e: Error) => void;
  vi.spyOn(sender as never as { cloneOn: () => unknown }, "cloneOn")
    .mockImplementation(() => new Promise((_, reject) => (fail = reject)));
  const id = await startOnMini(laptop, sender, computerId, projectId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(id)).setup?.state).toBe("cloning"),
  );

  await sender.abandon(id);
  expect((await laptop.chats.get(id)).setup?.state).toBe("dropped");
  fail(new Error("fatal: could not read Username"));
  await sender.finished(id);
  const chat = await laptop.chats.get(id);
  expect(chat.sentTo).toBeUndefined();
  expect(chat.setup?.state).toBe("dropped");
  expect((mini.store.get().chats ?? []).some((c) => c.cameFrom)).toBe(false);
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
  // A Relay from before bridge 10 can't say, and one from before live handoffs can't take threads.
  expect(outdated(null)).toBe(true);
  expect(
    outdated({
      version: "0.8.0",
      bridge: liveHandoffBridge - 1,
      update: { status: "idle", current: "0.8.0" },
    }),
  ).toBe(true);
  expect(
    outdated({
      version: "0.9.0",
      bridge: liveHandoffBridge,
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
  left.messages = left.messages.slice(0, left.sentTo!.kept);
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

it("adds a folder on the other computer as a project that lives there, and starts its threads there in that folder", async () => {
  const { laptop, mini, sender, computers, computerId } =
    await pairedComputers();
  const remote = new RemoteProjects(computers, laptop.projects);
  const notes = join(mini.dir, "notes");
  await mkdir(notes);
  await writeFile(join(notes, "todo.md"), "- tidy\n");

  // Its folders, the one already a project there marked.
  const listed = await remote.folders(computerId, mini.dir);
  expect(listed.dir).toBe(mini.dir);
  expect(listed.folders).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "app",
        repository: true,
        project: { id: mini.projectId, name: "App" },
      }),
      expect.objectContaining({ name: "notes", repository: false }),
    ]),
  );

  const project = await remote.add(computerId, notes);
  const [added] = (await mini.projects.list(null)).filter(
    (p) => p.path === notes,
  );
  expect(project).toMatchObject({
    name: "Notes",
    plain: true,
    computer: { id: computerId, projectId: added!.id, plain: true },
  });
  // Added again, it's the same project; nothing here reads its folder.
  expect((await remote.add(computerId, notes)).id).toBe(project.id);
  await expect(laptop.projects.inspect(project.id)).rejects.toThrow(
    "isn't on this one",
  );

  // Its threads work in the folder there; none gets a worktree.
  const thread = await laptop.chats.create(
    project.id,
    { kind: "project" },
    "worktree",
  );
  expect(thread.worktree).toBeUndefined();
  const first = input("@codex Tidy the notes");
  await laptop.chats.firstMessageOnly(thread.id, first);
  await sender.handOff(thread.id, computerId);
  await vi.waitFor(async () =>
    expect((await laptop.chats.get(thread.id)).sentTo).toMatchObject({
      state: "away",
      live: true,
      home: true,
      folder: true,
      kept: 0,
    }),
  );
  const [there] = mini.chats.list(added!.id);
  expect(there).toMatchObject({ cameFrom: { home: true } });
  expect(there!.worktree).toBeUndefined();
  await finished(mini.chats, there!.id, 2);
  expect((await prompts()).at(-1)).toContain("Tidy the notes");
  // What it answers there mirrors here, the first message included.
  await vi.waitFor(async () =>
    expect(
      (await laptop.chats.get(thread.id)).messages.map((m) => m.role),
    ).toEqual(["user", "assistant"]),
  );
  // It never comes back: there's no folder here for it.
  await expect(sender.bringBack(thread.id)).rejects.toThrow("runs there only");
  await expect(sender.abandon(thread.id)).rejects.toThrow("runs there only");

  // Calls about the project itself run on its folder there.
  const unwatch = vi.fn(() => "unwatched");
  expect(remote.forwards("projectWorkingTree", [project.id])).toBe(true);
  expect(
    await remote.forward("projectWorkingTree", [project.id], unwatch),
  ).toEqual({ ran: "projectWorkingTree", on: added!.id });
  expect(remote.forwards("projectWorkingTree", [laptop.projectId])).toBe(false);
  // A thread's own folder calls go with the thread.
  expect(
    remote.forwards("projectWorkingTree", [workspaceId(project.id, thread.id)]),
  ).toBe(false);
  // Watching it here stops the window's last watch, as nothing here can watch it.
  expect(await remote.forward("watchWorkingTree", [project.id], unwatch)).toBe(
    "unwatched",
  );
  await expect(
    remote.forward("revealProjectPath", [project.id, ""], unwatch),
  ).rejects.toThrow("isn't on this one");
});

it("opens a remote project's shells on its computer, in its folder, and shows their output on the computer that opened them alone", async () => {
  // No pty in tests: the shells themselves are ThreadTerminals', as here.
  const sinks: ((event: TerminalEvent) => void)[] = [];
  const spies = [
    vi
      .spyOn(ThreadTerminals.prototype, "connect")
      .mockImplementation((send) => void sinks.push(send)),
    vi
      .spyOn(ThreadTerminals.prototype, "open")
      .mockImplementation((_key, cwd) => ({ cwd, backlog: "" })),
    vi.spyOn(ThreadTerminals.prototype, "write").mockImplementation(() => {}),
    vi.spyOn(ThreadTerminals.prototype, "adopt").mockImplementation(() => {}),
    vi.spyOn(ThreadTerminals.prototype, "close").mockImplementation(() => {}),
  ] as const;
  const [, open, write, adopt, close] = spies;
  const passed = vi.spyOn(threadTerminals, "pass").mockImplementation(() => {});
  cleanup.push(() => {
    for (const spy of [...spies, passed]) spy.mockRestore();
  });
  const { laptop, mini, computers, computerId } = await pairedComputers();
  const remote = new RemoteProjects(computers, laptop.projects);
  const folder = await mini.projects.root(mini.projectId);
  const project = await remote.add(computerId, folder);
  const draft = draftTerminalKey(project.id);
  const size = { cols: 80, rows: 24 };

  expect(remote.forwards("openTerminal", [project.id, null, size])).toBe(true);
  expect(remote.forwards("openTerminal", [laptop.projectId, null, size])).toBe(
    false,
  );
  expect(remote.forwards("writeTerminal", [draft, "pwd\r"])).toBe(false);
  expect(
    await remote.forward("openTerminal", [project.id, null, size], vi.fn()),
  ).toEqual({ cwd: folder, backlog: "" });
  // Kept there apart from that computer's own shells, by who opened it.
  const there = open.mock.calls[0]![0];
  const device = there.slice(0, -draft.length - 1);
  expect(there).toBe(`${device}@${draft}`);
  expect(open).toHaveBeenCalledWith(there, folder, 80, 24, false);

  expect(remote.forwards("writeTerminal", [draft, "pwd\r"])).toBe(true);
  await remote.forward("writeTerminal", [draft, "pwd\r"], vi.fn());
  expect(write).toHaveBeenCalledWith(there, "pwd\r");
  // Output for a shell this computer didn't open isn't shown; its own is.
  sinks[0]!({ key: `${device}@draft:${randomUUID()}`, data: "not yours" });
  sinks[0]!({ key: there, data: folder });
  await vi.waitFor(() =>
    expect(passed).toHaveBeenCalledWith({ key: draft, data: folder }),
  );
  expect(passed).toHaveBeenCalledTimes(1);

  // The draft's shell goes along to the thread its first message started.
  const chatId = randomUUID();
  await remote.forward("adoptTerminal", [project.id, chatId], vi.fn());
  expect(adopt).toHaveBeenCalledWith(there, `${device}@${chatId}`);
  expect(remote.forwards("writeTerminal", [draft, "x"])).toBe(false);
  await remote.forward(
    "openTerminal",
    [project.id, chatId, size, false, "b"],
    vi.fn(),
  );

  // The computer drops; a shell closed meanwhile closes there once it's back.
  computers.close();
  await remote.forward("closeTerminal", [chatId], vi.fn());
  expect(close).not.toHaveBeenCalled();
  expect(remote.forwards("writeTerminal", [chatId, "x"])).toBe(false);
  open.mockClear();
  open.mockImplementation((_key, cwd) => ({ cwd, backlog: "missed\r\n" }));
  await computers.start();
  await vi.waitFor(
    () => expect(close).toHaveBeenCalledWith(`${device}@${chatId}`),
    { timeout: 30000 },
  );
  // The other one is attached again: its flow starts over, and what it
  // printed while the computer was away replaces what the window shows.
  await vi.waitFor(() =>
    expect(passed).toHaveBeenCalledWith({
      key: `${chatId}~b`,
      data: "\x1bcmissed\r\n",
    }),
  );
  expect(open).toHaveBeenCalledWith(
    `${device}@${chatId}~b`,
    folder,
    80,
    24,
    false,
  );
}, 90000);
