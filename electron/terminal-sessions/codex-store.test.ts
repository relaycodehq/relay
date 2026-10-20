import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeStoredCodexSession } from "../../tests/fixtures/codex-store";
import { storedCodexHistory, storedCodexSessions } from "./codex-store";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "relay-codex-store-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));
const turns = [{ prompt: "Find the guard", answer: "In cache.ts." }];
const roots = new Set(["/repo"]);

it("lists older desktop chats by their app names, excluding missing, archived, other-folder and Relay histories", async () => {
  const { statePath } = await writeStoredCodexSession(
    home,
    "/repo",
    "desktop-01",
    turns,
    {
      name: "Inspect release script",
      ago: 60 * 86_400_000,
    },
  );
  await writeStoredCodexSession(home, "/repo", "old-app-01", turns, {
    originator: null,
  });
  await writeStoredCodexSession(home, "/repo", "tui-chat-01", turns, {
    originator: "codex-tui",
  });
  await writeStoredCodexSession(home, "/repo", "relay-chat-01", turns, {
    originator: "relay",
  });
  await writeStoredCodexSession(home, "/other", "other-chat-01", turns);
  await writeStoredCodexSession(home, "/repo", "archived-01", turns, {
    archived: true,
  });
  await writeStoredCodexSession(home, "/repo", "missing-01", []);
  await writeStoredCodexSession(home, "/repo", "subagent-01", turns, {
    source: '{"subagent":"review"}',
  });
  const before = await readFile(statePath);
  const rows = await storedCodexSessions(home, roots, 30);
  expect(rows.map((r) => r.id).sort()).toEqual([
    "desktop-01",
    "old-app-01",
    "tui-chat-01",
  ]);
  expect(rows.find((r) => r.id === "desktop-01")).toMatchObject({
    title: "Inspect release script",
    app: true,
    turns: 1,
  });
  expect(rows.find((r) => r.id === "old-app-01")?.app).toBe(true);
  expect(rows.find((r) => r.id === "tui-chat-01")?.app).toBeUndefined();
  expect(await readFile(statePath)).toEqual(before);
  expect(await storedCodexSessions(home, roots, 30, "other-chat-01")).toEqual(
    [],
  );
  expect(await storedCodexSessions(home, roots, 30, "archived-01")).toEqual([]);
});

it("converts prompts, commentary and tool results, cutting only at a completed turn", async () => {
  const { path } = await writeStoredCodexSession(home, "/repo", "desktop-01", [
    ...turns,
    { prompt: "Fix it", answer: "Half", status: "interrupted" },
  ]);
  const before = await readFile(path);
  const { messages, cut } = storedCodexHistory(path, "desktop-01");
  expect(messages.map((m) => [m.role, m.body])).toEqual([
    ["user", "Find the guard"],
    ["assistant", "In cache.ts."],
    ["user", "Fix it"],
    ["assistant", "Half"],
  ]);
  expect(messages[1]?.trace).toMatchObject([
    { kind: "commentary", text: "Checking the project." },
    {
      kind: "activity",
      activity: {
        kind: "command",
        label: "rg guard",
        detail: "found",
        status: "complete",
      },
    },
  ]);
  expect(messages[3]?.status).toBe("cancelled");
  expect(cut).toEqual({
    message: messages[1]?.id,
    point: { thread: "desktop-01", at: "turn-0" },
  });
  expect(await readFile(path)).toEqual(before);
});

it("does not invent fork points for unfinished chats, and surfaces malformed history", async () => {
  const { path } = await writeStoredCodexSession(home, "/repo", "desktop-01", [
    { ...turns[0]!, done: false },
  ]);
  expect(storedCodexHistory(path, "desktop-01").cut).toBeUndefined();
  const db = new DatabaseSync(path);
  db.prepare("UPDATE thread_items SET item_json = ? WHERE item_id = 'u0'").run(
    "broken JSON",
  );
  db.close();
  expect(() => storedCodexHistory(path, "desktop-01")).toThrow();
});

it("leaves missing stores alone and reports corrupt databases", async () => {
  expect(await storedCodexSessions(home, roots, 30)).toEqual([]);
  const { statePath } = await writeStoredCodexSession(
    home,
    "/repo",
    "desktop-01",
    turns,
  );
  await writeFile(statePath, "corrupt");
  await expect(storedCodexSessions(home, roots, 30)).rejects.toThrow();
});
