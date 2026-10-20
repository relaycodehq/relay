import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import { ProjectChats } from "./index";
import { writeStoredCodexSession } from "../../tests/fixtures/codex-store";
import {
  writeClaudeSession,
  claudeTurns,
  writeCodexSession,
} from "../../tests/fixtures/terminal-sessions";

let dir: string,
  repo: string,
  home: string,
  chats: ProjectChats,
  projects: Projects,
  store: Store;
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-import-")));
  repo = join(dir, "onboarding");
  home = join(dir, "codex");
  await mkdir(repo);
  vi.stubEnv("CODEX_HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(dir, "claude"));
  store = new Store(join(dir, "state"));
  await store.load();
  projects = new Projects(store);
  chats = new ProjectChats(store, projects, join(dir, "chats"), () => {});
});
afterEach(async () => {
  await chats?.dispose();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true, maxRetries: 20 });
});
const turns = [
  { prompt: "Inspect the release script", answer: "It signs the build." },
];

it("discovers without adding, lists every readable chat, imports a selection once and preserves existing project names", async () => {
  for (let i = 0; i < 34; i++)
    await writeStoredCodexSession(
      home,
      repo,
      `desktop-chat-${String(i).padStart(2, "0")}`,
      turns,
      { name: `Chat ${i}`, ago: 60 * 86_400_000 },
    );
  await writeStoredCodexSession(home, repo, "missing-history", []);
  const [source] = await chats.imports.list("codex");
  expect(source).toMatchObject({
    path: repo,
    missing: false,
    name: "onboarding",
  });
  expect(await projects.list(null)).toHaveLength(0);
  const available = await chats.imports.chats("codex", source!.key);
  expect(available).toHaveLength(34);
  const ids = available.slice(0, 2).map((c) => c.id);
  const before = await readFile(join(home, "thread_history_1.sqlite"));
  const first = await chats.imports.run("codex", [
    { key: source!.key, chats: ids },
  ]);
  expect(first.failures).toEqual([]);
  expect(first.projects[0]?.chats.map((c) => c.created)).toEqual([true, true]);
  const project = first.projects[0]!.project;
  await projects.rename(project.id, "My Onboarding");
  const again = await chats.imports.run("codex", [
    { key: source!.key, chats: ids },
  ]);
  expect(again.projects[0]?.project.name).toBe("My Onboarding");
  expect(again.projects[0]?.chats.map((c) => c.created)).toEqual([
    false,
    false,
  ]);
  expect(chats.list(project.id)).toHaveLength(2);
  expect(
    (await chats.imports.chats("codex", source!.key)).filter((c) => c.chatId),
  ).toHaveLength(2);
  expect(await readFile(join(home, "thread_history_1.sqlite"))).toEqual(before);
});

it("imports an older JSONL session and a Claude session as copies through the same service", async () => {
  const path = await writeCodexSession(home, repo, "old-desktop-01", turns, {
    originator: "Codex Desktop",
  });
  const old = join(
    home,
    "sessions",
    "2020",
    "01",
    "01",
    "rollout-old-old-desktop-01.jsonl",
  );
  await mkdir(dirname(old), { recursive: true });
  await rename(path, old);
  await writeClaudeSession(
    join(dir, "claude"),
    repo,
    "claude-idle-01",
    claudeTurns(turns),
    { ago: 3_600_000 },
  );
  for (const app of ["codex", "claude"] as const) {
    const [source] = await chats.imports.list(app);
    const [session] = await chats.imports.chats(app, source!.key);
    expect(session).toBeDefined();
    const result = await chats.imports.run(app, [
      { key: source!.key, chats: [session!.id] },
    ]);
    expect(result.failures).toEqual([]);
    const chat = await chats.get(result.projects[0]!.chats[0]!.chat.id);
    expect(chat.messages.map((m) => m.body)).toEqual(
      turns.flatMap((t) => [t.prompt, t.answer]),
    );
    expect(chat.fromTerminal).toMatchObject({ provider: app, how: "forked" });
    expect(chat.sessions).toBeUndefined();
  }
  expect(await projects.list(null)).toHaveLength(1);
});

it("requires an explicit destination for missing folders and keeps an unfinished tail", async () => {
  const gone = join(dir, "deleted-folder");
  await writeStoredCodexSession(home, gone, "unfinished-chat-01", [
    ...turns,
    { prompt: "Now publish it", answer: "Half done", done: false },
  ]);
  const [source] = await chats.imports.list("codex");
  expect(source?.missing).toBe(true);
  const failed = await chats.imports.run("codex", [
    { key: source!.key, chats: ["unfinished-chat-01"] },
  ]);
  expect(failed.failures).toHaveLength(1);
  expect(await projects.list(null)).toHaveLength(0);
  const result = await chats.imports.run("codex", [
    { key: source!.key, folder: repo, chats: ["unfinished-chat-01"] },
  ]);
  expect(result.failures).toEqual([]);
  const chat = await chats.get(result.projects[0]!.chats[0]!.chat.id);
  expect(chat.fromTerminal?.how).toBe("text");
  expect(chat.messages.map((m) => m.body)).toEqual([
    turns[0]!.prompt,
    turns[0]!.answer,
    "Now publish it",
    "Half done",
  ]);
  expect(chat.movedIn).toMatchObject({ from: gone, to: repo, selected: true });
});

it("reports partial failures and retries without duplicating successful chats", async () => {
  const { path } = await writeStoredCodexSession(
    home,
    repo,
    "good-chat-01",
    turns,
  );
  await writeStoredCodexSession(home, repo, "broken-chat-01", turns);
  const db = new DatabaseSync(path);
  const saved = db
    .prepare(
      "SELECT item_json FROM thread_items WHERE thread_id='broken-chat-01' AND item_id='u0'",
    )
    .get()!.item_json as string;
  db.prepare(
    "UPDATE thread_items SET item_json='bad JSON' WHERE thread_id='broken-chat-01' AND item_id='u0'",
  ).run();
  db.close();
  const [source] = await chats.imports.list("codex");
  const pick = { key: source!.key, chats: ["good-chat-01", "broken-chat-01"] };
  const first = await chats.imports.run("codex", [pick]);
  expect(first.projects[0]?.chats).toHaveLength(1);
  expect(first.failures).toMatchObject([{ chatId: "broken-chat-01" }]);
  const repair = new DatabaseSync(path);
  repair
    .prepare(
      "UPDATE thread_items SET item_json=? WHERE thread_id='broken-chat-01' AND item_id='u0'",
    )
    .run(saved);
  repair.close();
  const retried = await chats.imports.run("codex", [pick]);
  expect(retried.failures).toEqual([]);
  expect(retried.projects[0]?.chats.map((c) => c.created)).toEqual([
    false,
    true,
  ]);
  expect(chats.list(first.projects[0]!.project.id)).toHaveLength(2);
});

it("rejects forged project keys and chats from other projects before adding anything", async () => {
  await writeStoredCodexSession(home, repo, "first-chat-01", turns);
  await writeStoredCodexSession(
    home,
    join(dir, "other"),
    "other-chat-01",
    turns,
  );
  await expect(
    chats.imports.run("codex", [{ key: "made-up", chats: [] }]),
  ).rejects.toThrow("no longer");
  const source = (await chats.imports.list("codex")).find(
    (p) => p.path === repo,
  )!;
  const wrong = await chats.imports.run("codex", [
    { key: source.key, chats: ["other-chat-01"] },
  ]);
  expect(wrong.failures[0]?.message).toContain("no longer available");
  expect(await projects.list(null)).toHaveLength(0);
});

it("imports a project's app name without reading chat history when chats are not selected", async () => {
  const { statePath, path } = await writeStoredCodexSession(
    home,
    repo,
    "empty-history-01",
    [],
  );
  const db = new DatabaseSync(statePath);
  db.exec(`CREATE TABLE projects(id TEXT, name TEXT, position INTEGER);
    CREATE TABLE project_roots(project_id TEXT, path TEXT, position INTEGER);`);
  db.prepare("INSERT INTO projects VALUES ('p1', 'My app project', 0)").run();
  db.prepare("INSERT INTO project_roots VALUES ('p1', ?, 0)").run(repo);
  db.close();
  await rm(path);
  const [source] = await chats.imports.list("codex");
  expect(source?.name).toBe("My app project");
  const result = await chats.imports.run("codex", [
    { key: source!.key, chats: [] },
  ]);
  expect(result.failures).toEqual([]);
  expect(result.projects[0]?.project.name).toBe("My app project");
  expect(result.projects[0]?.chats).toEqual([]);
});
