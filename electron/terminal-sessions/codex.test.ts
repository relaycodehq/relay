import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { writeCodexSession } from "../../tests/fixtures/terminal-sessions";
import { codexHistory, codexNames, codexOrigin, codexSummary } from "./codex";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "relay-codex-"));
});
afterEach(() => rm(home, { recursive: true, force: true }));

const turns = [
  { prompt: "Find the guard", answer: "In cache.ts." },
  { prompt: "Fix it", answer: "Fixed." },
];

it("tells terminal sessions from Relay's and exec's by their first line", async () => {
  const cli = await writeCodexSession(home, "/repo", "id-cli", turns, {
    source: "cli",
  });
  const tui = await writeCodexSession(home, "/repo", "id-tui", turns, {
    source: "vscode",
    originator: "codex-tui",
  });
  const desktop = await writeCodexSession(home, "/repo", "id-desktop", turns, {
    source: "vscode",
    originator: "Codex Desktop",
  });
  const subagent = await writeCodexSession(
    home,
    "/repo",
    "id-guardian",
    turns,
    {
      source: { subagent: "guardian" },
      originator: "codex-tui",
    },
  );
  const relay = await writeCodexSession(home, "/repo", "id-relay", turns, {
    source: "vscode",
    originator: "relay",
  });
  const exec = await writeCodexSession(home, "/repo", "id-exec", turns, {
    source: "exec",
    originator: "codex_exec",
  });
  expect(await codexOrigin(cli)).toEqual({
    id: "id-cli",
    cwd: "/repo",
    terminal: true,
  });
  expect(await codexOrigin(tui)).toEqual({
    id: "id-tui",
    cwd: "/repo",
    terminal: true,
  });
  expect((await codexOrigin(desktop))?.terminal).toBe(false);
  expect((await codexOrigin(subagent))?.terminal).toBe(false);
  expect((await codexOrigin(relay))?.terminal).toBe(false);
  expect((await codexOrigin(exec))?.terminal).toBe(false);
});

it("reads a first line longer than the usual head", async () => {
  const path = await writeCodexSession(home, "/repo", "id-long", turns);
  const text = await readFile(path, "utf8");
  const meta = JSON.parse(text.split("\n")[0]!);
  meta.payload.base_instructions.text = "y".repeat(200_000);
  await writeFile(
    path,
    [JSON.stringify(meta), ...text.split("\n").slice(1)].join("\n"),
  );
  expect((await codexOrigin(path))?.cwd).toBe("/repo");
});

it("counts prompts and reads names, the latest per id", async () => {
  const path = await writeCodexSession(home, "/repo", "id-1", turns, {
    name: "Old",
  });
  await appendFile(
    join(home, "session_index.jsonl"),
    JSON.stringify({ id: "id-1", thread_name: "Cache guard" }) + "\n",
  );
  expect(await codexSummary(path)).toEqual({
    first: "Find the guard",
    turns: 2,
  });
  expect(
    (await codexNames(join(home, "session_index.jsonl"))).get("id-1"),
  ).toBe("Cache guard");
});

it("turns a rollout into prompts and answers, cut after the last finished turn", async () => {
  const path = await writeCodexSession(home, "/repo", "id-1", [
    ...turns,
    { prompt: "Still going", answer: "Half", done: false },
  ]);
  const { messages, cut } = await codexHistory(path, "id-1");
  expect(messages.map((m) => [m.role, m.body])).toEqual([
    ["user", "Find the guard"],
    ["assistant", "In cache.ts."],
    ["user", "Fix it"],
    ["assistant", "Fixed."],
    ["user", "Still going"],
    ["assistant", "Half"],
  ]);
  expect(messages[1]).toMatchObject({
    provider: "codex",
    model: { name: "gpt-5.5-codex" },
    trace: [
      { kind: "commentary", id: "c0", text: "Checking (0)." },
      {
        kind: "activity",
        id: "cmd0",
        activity: expect.objectContaining({
          kind: "command",
          label: "rg guard 0",
          detail: "hit 0",
          status: "complete",
        }),
      },
    ],
  });
  expect(cut).toEqual({
    message: messages[3]!.id,
    point: { thread: "id-1", at: "turn-1" },
  });
});
