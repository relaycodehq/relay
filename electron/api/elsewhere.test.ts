import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectChat } from "../../shared/projects";
import type { ApiContext } from "./context";
import { elsewhereHandlers } from "./elsewhere";
import { initRepo } from "../../tests/fixtures/git-repo";

let base: string, home: string, clone: string;
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
async function repo(name: string) {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  initRepo(root);
  for (const f of ["a.ts", "b.ts", "other.ts"])
    await writeFile(join(root, f), "one\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial");
  return root;
}
const LEAD = "11111111-1111-4111-8111-111111111111",
  HELPER = "22222222-2222-4222-8222-222222222222",
  PORTER = "33333333-3333-4333-8333-333333333333",
  REVIEWER = "44444444-4444-4444-8444-444444444444";

function setup() {
  const chat = (
    id: string,
    title: string,
    messages: Partial<ProjectChat["messages"][number]>[],
    extra: Partial<ProjectChat> = {},
  ) => ({ id, projectId: "p", title, messages, ...extra }) as ProjectChat;
  const chats = new Map([
    [
      LEAD,
      chat(LEAD, "Lead", [{ elsewhere: [{ root: clone, paths: ["a.ts"] }] }]),
    ],
    [
      HELPER,
      chat(HELPER, "Fix status test", [
        { changes: [{ path: "b.ts", additions: 1, deletions: 1 }] },
      ]),
    ],
    [
      PORTER,
      chat(PORTER, "Port shader", [
        { changes: [{ path: "a.ts", additions: 1, deletions: 1 }] },
      ]),
    ],
    [
      REVIEWER,
      chat(REVIEWER, "Reviewer", [
        { changes: [{ path: "other.ts", additions: 1, deletions: 0 }] },
      ]),
    ],
  ]);
  const folders: Record<string, string> = {
    [LEAD]: home,
    [HELPER]: home,
    [PORTER]: clone,
    [REVIEWER]: clone,
  };
  const started = [
    { id: HELPER, title: "Fix status test" },
    { id: PORTER, title: "Port shader" },
    { id: REVIEWER, title: "Reviewer", reviewer: { parent: LEAD } },
  ];
  const saved = new Set<(chat: ProjectChat) => void>();
  const get = vi.fn(async (id: string) => structuredClone(chats.get(id)!));
  const send = vi.fn();
  const ctx = {
    store: { get: () => ({ projects: [] }) },
    window: { send, caller: () => null },
    projectChats: {
      get,
      terminalFolder: async (_: string, id: string) => folders[id],
      startedThreads: () => started,
      onSaved: (listener: (chat: ProjectChat) => void) => {
        saved.add(listener);
        return () => saved.delete(listener);
      },
    },
  } as unknown as ApiContext;
  /** Saves a thread as a turn ending would. */
  const save = (chat: ProjectChat) => {
    chats.set(chat.id, chat);
    for (const listener of saved) listener(chat);
  };
  return {
    h: elsewhereHandlers(ctx),
    chats,
    folders,
    started,
    get,
    send,
    save,
  };
}
const handlers = () => setup().h;

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "relay-elsewhere-api-")));
  home = await repo("home");
  clone = await repo("clone");
  for (const root of [home, clone])
    for (const f of ["a.ts", "b.ts", "other.ts"])
      await writeFile(join(root, f), "one\nchanged\n");
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

it("lists the other repository's touched files, and names started threads in the thread's own", async () => {
  const h = handlers();
  expect(await h.threadElsewhere([LEAD])).toEqual({
    here: { "b.ts": [{ chatId: HELPER, title: "Fix status test" }] },
    groups: [
      expect.objectContaining({
        root: clone,
        name: "clone",
        branch: "main",
        files: [
          {
            path: "a.ts",
            additions: 1,
            deletions: 0,
            own: true,
            by: [{ chatId: PORTER, title: "Port shader" }],
          },
        ],
      }),
    ],
  });
});

it("finds a started thread's files when its folder is reached through a symlink", async () => {
  const { h, folders } = setup();
  folders[PORTER] = join(base, "linked");
  await symlink(clone, folders[PORTER]);
  const { groups } = await h.threadElsewhere([LEAD]);
  expect(groups[0]?.files).toEqual([
    expect.objectContaining({
      path: "a.ts",
      by: [{ chatId: PORTER, title: "Port shader" }],
    }),
  ]);
});

it("shows and commits only files the thread's agents changed there", async () => {
  const h = handlers();
  await expect(
    h.threadElsewhereDiff([LEAD, clone, "other.ts"]),
  ).rejects.toThrow("didn't change that file");
  await expect(h.threadElsewhereDiff([LEAD, home, "b.ts"])).rejects.toThrow();
  expect(
    (await h.threadElsewhereDiff([LEAD, clone, "a.ts"])).next?.contents,
  ).toBe("one\nchanged\n");
  const { groups } = await h.threadElsewhere([LEAD]);
  const after = await h.threadElsewhereCommit([
    LEAD,
    clone,
    groups[0]!.revision,
    "Port it",
  ]);
  expect(after.groups).toEqual([]);
  expect(git(clone, "status", "--porcelain")).toBe(" M b.ts\n M other.ts\n");
  expect(git(clone, "show", "--name-only", "--format=%s", "HEAD").trim()).toBe(
    "Port it\n\na.ts",
  );
});

it("reads the threads once, until a turn records other files", async () => {
  const { h, chats, get, send, save } = setup();
  const first = await h.threadElsewhere([LEAD]);
  const reads = get.mock.calls.length;
  expect(reads).toBe(3);
  expect(await h.threadElsewhere([LEAD])).toEqual(first);
  expect(get).toHaveBeenCalledTimes(reads);

  // Saved mid-turn, with nothing new recorded: the reading holds.
  const lead = structuredClone(chats.get(LEAD)!);
  lead.title = "Lead, renamed";
  save(lead);
  await h.threadElsewhere([LEAD]);
  expect(get).toHaveBeenCalledTimes(reads);
  expect(send).not.toHaveBeenCalled();

  // A helper's turn ends having changed a file in the clone.
  const helper = structuredClone(chats.get(HELPER)!);
  helper.messages.push({
    elsewhere: [{ root: clone, paths: ["b.ts"] }],
  } as ProjectChat["messages"][number]);
  save(helper);
  expect(send).toHaveBeenCalledWith("relay:elsewhere", LEAD);
  const after = await h.threadElsewhere([LEAD]);
  expect(get).toHaveBeenCalledTimes(reads * 2);
  expect(after.groups[0]!.files.map((f) => [f.path, f.by])).toEqual([
    ["a.ts", [{ chatId: PORTER, title: "Port shader" }]],
    ["b.ts", [{ chatId: HELPER, title: "Fix status test" }]],
  ]);
});

it("reads again when a rollback or a newly started thread changes what was touched", async () => {
  const { h, chats, started, get, send, save } = setup();
  await h.threadElsewhere([LEAD]);
  const reads = get.mock.calls.length;

  const porter = structuredClone(chats.get(PORTER)!);
  porter.messages[0]!.changes![0]!.revertedBy = "undo";
  save(porter);
  expect(send).toHaveBeenCalledWith("relay:elsewhere", LEAD);
  const reverted = await h.threadElsewhere([LEAD]);
  expect(reverted.groups[0]!.files[0]!.by).toEqual([]);
  expect(get).toHaveBeenCalledTimes(reads * 2);

  // Started since: listed now, so the reading is stale even before it saves.
  const NEW = "55555555-5555-4555-8555-555555555555";
  chats.set(NEW, {
    id: NEW,
    projectId: "p",
    title: "New",
    messages: [],
  } as unknown as ProjectChat);
  started.push({ id: NEW, title: "New" });
  await h.threadElsewhere([LEAD]);
  expect(get).toHaveBeenCalledTimes(reads * 3 + 1);
});
