import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectChat } from "../../shared/projects";
import type { ApiContext } from "./context";
import { elsewhereHandlers } from "./elsewhere";

let base: string, home: string, clone: string;
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
async function repo(name: string) {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
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

function handlers() {
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
  const ctx = {
    store: { get: () => ({ projects: [] }) },
    projectChats: {
      get: async (id: string) => chats.get(id)!,
      terminalFolder: async (_: string, id: string) => folders[id],
      startedThreads: () => [
        { id: HELPER },
        { id: PORTER },
        { id: REVIEWER, reviewer: { parent: LEAD } },
      ],
    },
  } as unknown as ApiContext;
  return elsewhereHandlers(ctx);
}

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
