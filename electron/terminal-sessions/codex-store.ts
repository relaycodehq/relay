// Recent Codex versions move rollouts into these databases. Read them in
// place, without migrating or writing anything in the user's Codex home.
import { access } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { codexActivity } from "../agents/activity";
import { codexSessionOrigin, codexText } from "./codex";
import { Transcript } from "./transcript";

const threadSchema = z.object({
  id: z.string(),
  cwd: z.string(),
  title: z.string(),
  originator: z.string().nullable(),
  source: z.string(),
  updated: z.number(),
});

export interface StoredCodexSession {
  id: string;
  title: string;
  updated: number;
  turns: number;
  app?: true;
  path: string;
  storage: "sqlite";
}

/** Missing databases mean an older Codex; other read failures reach the picker. */
async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Only chats in this project's folder, with readable user messages; no date cutoff. */
export async function storedCodexSessions(
  home: string,
  roots: Set<string>,
  most: number,
  only?: string,
): Promise<StoredCodexSession[]> {
  const statePath = join(home, "state_5.sqlite");
  const path = join(home, "thread_history_1.sqlite");
  const present = await Promise.all([exists(statePath), exists(path)]);
  if (present.some((value) => !value)) return [];
  const state = new DatabaseSync(statePath, { readOnly: true });
  try {
    const history = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = state
        .prepare(
          `SELECT id, cwd, COALESCE(NULLIF(name, ''), title) AS title,
             originator, source, COALESCE(updated_at_ms, updated_at * 1000) AS updated
           FROM threads
           WHERE cwd IN (${[...roots].map(() => "?").join(",")})
             AND archived = 0 ${only ? "AND id = ?" : ""}
           ORDER BY updated_at DESC, id DESC`,
        )
        .iterate(...roots, ...(only ? [only] : []));
      const count = history.prepare(
        `SELECT COUNT(*) AS turns FROM thread_items i
         WHERE thread_id = ? AND item_type = 'userMessage'
           AND EXISTS (SELECT 1 FROM thread_turns t
             WHERE t.thread_id = i.thread_id AND t.turn_id = i.turn_id)`,
      );
      const found: StoredCodexSession[] = [];
      for (const row of rows) {
        const thread = threadSchema.parse(row);
        const origin = codexSessionOrigin(thread);
        if (!origin.terminal && !origin.app) continue;
        const { turns } = count.get(thread.id) as { turns: number };
        if (!turns) continue;
        found.push({
          id: thread.id,
          title: thread.title,
          updated: thread.updated,
          turns,
          ...(origin.app ? { app: true as const } : {}),
          path,
          storage: "sqlite",
        });
        if (found.length >= most) break;
      }
      return found;
    } finally {
      history.close();
    }
  } finally {
    state.close();
  }
}

const turnSchema = z.object({ turn_id: z.string(), status: z.string() });

const itemRowSchema = z.object({
  item_json: z.string(),
  created_at_ms: z.number(),
});

const itemSchema = z.object({ type: z.string(), id: z.string() }).loose();

const messageSchema = z.object({
  text: z.string(),
  phase: z.string().nullish(),
});

/** A consistent snapshot, streamed a turn at a time through the same message builder as JSONL. */
export function storedCodexHistory(path: string, id: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("BEGIN");
    const turns = db
      .prepare(
        "SELECT turn_id, status FROM thread_turns WHERE thread_id = ? ORDER BY rollout_ordinal",
      )
      .all(id);
    const items = db.prepare(
      `SELECT item_json, created_at_ms FROM thread_items
       WHERE thread_id = ? AND turn_id = ? ORDER BY rollout_ordinal`,
    );
    const transcript = new Transcript("codex", id);
    for (const raw of turns) {
      const turn = turnSchema.parse(raw);
      for (const row of items.iterate(id, turn.turn_id)) {
        const { item_json, created_at_ms: at } = itemRowSchema.parse(row);
        const item = itemSchema.parse(JSON.parse(item_json));
        if (item.type === "userMessage") {
          transcript.prompt(codexText(item.content) || "(empty message)", at);
        } else if (item.type === "agentMessage") {
          const message = messageSchema.parse(item);
          if (message.phase === "commentary")
            transcript.commentary(item.id, message.text, at);
          else transcript.text(item.id, message.text, at);
        } else {
          const activity = codexActivity("item/completed", item);
          if (activity) transcript.activity(activity, at);
        }
      }
      if (turn.status === "completed") {
        transcript.canCut(turn.turn_id);
        transcript.turnDone();
      } else if (turn.status === "interrupted" || turn.status === "failed") {
        transcript.stopped();
      }
    }
    return transcript.done();
  } finally {
    db.close();
  }
}

/** Declared desktop projects and working folders, including those whose folder is now missing. */
export async function storedCodexFolders(home: string) {
  const path = join(home, "state_5.sqlite");
  if (!(await exists(path))) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const folders = new Map<string, string>();
    // Older stores predate desktop projects, but still contain CLI threads.
    if (
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_roots'",
        )
        .get()
    ) {
      for (const row of db
        .prepare(
          "SELECT p.name, r.path FROM projects p JOIN project_roots r ON r.project_id = p.id ORDER BY p.position, r.position",
        )
        .all()) {
        if (typeof row.path === "string" && typeof row.name === "string")
          folders.set(row.path, row.name);
      }
    }
    for (const row of db
      .prepare(
        "SELECT DISTINCT cwd, source, originator FROM threads WHERE archived = 0",
      )
      .all()) {
      const origin = codexSessionOrigin(row);
      if (
        (origin.app || origin.terminal) &&
        typeof row.cwd === "string" &&
        !folders.has(row.cwd)
      )
        folders.set(row.cwd, "");
    }
    return [...folders].map(([path, name]) => ({ path, name }));
  } finally {
    db.close();
  }
}
