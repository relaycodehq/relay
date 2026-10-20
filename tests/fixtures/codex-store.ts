// The tables a paginated Codex chat uses, isolated from the real Codex home.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function writeStoredCodexSession(
  home: string,
  cwd: string,
  id: string,
  turns: { prompt: string; answer: string; done?: boolean; status?: string }[],
  {
    name = "Desktop chat",
    originator = "Codex Desktop" as string | null,
    source = "vscode",
    archived = false,
    ago = 0,
  } = {},
) {
  await mkdir(home, { recursive: true });
  const path = join(home, "thread_history_1.sqlite");
  const statePath = join(home, "state_5.sqlite");
  const state = new DatabaseSync(statePath);
  const history = new DatabaseSync(path);
  const now = Date.now() - ago;
  try {
    state.exec(`CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY, cwd TEXT, name TEXT, title TEXT,
      source TEXT, originator TEXT, archived INTEGER,
      updated_at INTEGER, updated_at_ms INTEGER
    )`);
    state
      .prepare("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        id,
        cwd,
        name,
        turns[0]?.prompt ?? "Missing history",
        source,
        originator,
        Number(archived),
        Math.floor(now / 1000),
        now,
      );
    history.exec(`
      CREATE TABLE IF NOT EXISTS thread_turns (
        thread_id TEXT, turn_id TEXT, rollout_ordinal INTEGER, status TEXT,
        PRIMARY KEY(thread_id, turn_id)
      );
      CREATE TABLE IF NOT EXISTS thread_items (
        thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER,
        created_at_ms INTEGER, item_json TEXT, item_type TEXT,
        PRIMARY KEY(thread_id, turn_id, item_id)
      )`);
    turns.forEach((turn, i) => {
      const turnId = `turn-${i}`;
      history
        .prepare("INSERT INTO thread_turns VALUES (?, ?, ?, ?)")
        .run(
          id,
          turnId,
          i * 10,
          turn.status ?? (turn.done === false ? "inProgress" : "completed"),
        );
      const items = [
        {
          type: "userMessage",
          id: `u${i}`,
          content: [{ type: "text", text: turn.prompt }],
        },
        {
          type: "agentMessage",
          id: `c${i}`,
          text: "Checking the project.",
          phase: "commentary",
        },
        {
          type: "commandExecution",
          id: `cmd${i}`,
          command: "rg guard",
          status: "completed",
          aggregatedOutput: "found",
          exitCode: 0,
        },
        {
          type: "agentMessage",
          id: `a${i}`,
          text: turn.answer,
          phase: "final_answer",
        },
      ];
      items.forEach((item, at) => {
        history
          .prepare("INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(
            id,
            turnId,
            item.id,
            i * 10 + at,
            now + i * 10 + at,
            JSON.stringify(item),
            item.type,
          );
      });
    });
  } finally {
    history.close();
    state.close();
  }
  return { path, statePath };
}
