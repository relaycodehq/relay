// Codex keeps each session as `<home>/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`:
// `session_meta` first, then what happened, turn by turn. Its app server's
// `thread/read` returns the same, but a long session's answer outgrows the
// 4 MiB frame Relay allows, so the file is read instead.
import { fileURLToPath } from "node:url";
import type { AgentActivity } from "../../shared/projects";
import { codexActivity } from "../agents/activity";
import { eachLine, headLines, parsed } from "./scan";
import { Transcript, type Imported } from "./transcript";

/** Where a session ran and whether it came from the `codex` command in a terminal. */
export async function codexOrigin(path: string) {
  let lines = await headLines(path);
  // `session_meta` carries the base instructions; a long set outgrows the usual read.
  if (!lines.length) lines = await headLines(path, 1024 * 1024);
  const meta = parsed(lines[0] ?? "");
  const payload = meta?.type === "session_meta" ? meta.payload : undefined;
  if (typeof payload?.cwd !== "string" || typeof payload.id !== "string")
    return;
  return {
    id: payload.id as string,
    cwd: payload.cwd as string,
    // The TUI says "vscode" as its source since 0.160 and older ones said "cli",
    // so the originator decides; a subagent's source is an object.
    terminal:
      (payload.originator === "codex-tui" &&
        typeof payload.source === "string") ||
      (payload.source === "cli" && payload.originator !== "relay"),
  };
}

const textOf = (content: unknown) =>
  Array.isArray(content)
    ? content
        .flatMap((part) =>
          part && typeof part.text === "string"
            ? [part.text as string]
            : part?.type === "image" || part?.type === "local_image"
              ? ["(image)"]
              : [],
        )
        .join("\n")
        .trim()
    : "";

/** A session's first prompt and how many it holds. */
export async function codexSummary(path: string) {
  let first = "",
    turns = 0;
  await eachLine(path, ['"type":"UserMessage"'], (line) => {
    const item = parsed(line)?.payload?.item;
    if (item?.type !== "UserMessage") return;
    turns++;
    first ||= textOf(item.content);
  });
  return { first, turns };
}

/** Names given to sessions, by id; the latest line for an id wins. */
export async function codexNames(index: string) {
  const names = new Map<string, string>();
  await eachLine(index, ['"thread_name"'], (line) => {
    const entry = parsed(line);
    if (typeof entry?.id === "string" && typeof entry.thread_name === "string")
      names.set(entry.id, entry.thread_name);
  });
  return names;
}

const path = (value: unknown) =>
  typeof value === "string" && value.startsWith("file:")
    ? fileURLToPath(value)
    : value;

/** A rollout item as the app server names it, so it reads like a live turn's. */
function liveItem(item: Record<string, any>): unknown {
  const status = item.status === "failed" ? "failed" : "completed";
  switch (item.type) {
    case "CommandExecution": {
      const command = Array.isArray(item.command)
        ? // A shell call is ["/bin/zsh", "-lc", "<command>"].
          item.command.length === 3 && item.command[1] === "-lc"
          ? item.command[2]
          : item.command.join(" ")
        : item.command;
      return {
        type: "commandExecution",
        id: item.id,
        command,
        aggregatedOutput: item.aggregated_output ?? item.formatted_output,
        exitCode: item.exit_code,
        status,
      };
    }
    case "FileChange":
      return {
        type: "fileChange",
        id: item.id,
        changes: Object.keys(item.changes ?? {}).map((p) => ({ path: p })),
        status,
      };
    case "ImageView":
      return { type: "imageView", id: item.id, path: path(item.path) };
    case "McpToolCall":
      return {
        type: "mcpToolCall",
        id: item.id,
        server: item.server,
        tool: item.tool,
        status,
      };
  }
}

function activityOf(item: Record<string, any>): AgentActivity | undefined {
  if (typeof item.id !== "string") return;
  if (item.type === "Extension" && typeof item.query === "string")
    return {
      id: item.id.slice(0, 180),
      kind: "web",
      label: item.query.slice(0, 500),
      status: "complete",
    };
  return codexActivity("item/completed", liveItem(item));
}

const time = (line: Record<string, any>) => {
  const at = Date.parse(line.timestamp);
  return Number.isFinite(at) ? at : 0;
};

/** The conversation in a rollout; a finished turn's id is where a fork can cut it. */
export async function codexHistory(file: string, session: string) {
  const lines: Record<string, any>[] = [];
  await eachLine(
    file,
    ['"item_completed"', '"task_complete"', '"turn_aborted"', '"turn_context"'],
    (line) => {
      const entry = parsed(line);
      if (entry) lines.push(entry);
    },
  );
  return codexTranscript(lines, session);
}

export function codexTranscript(
  lines: Record<string, any>[],
  session: string,
): Imported {
  const transcript = new Transcript("codex", session);
  let model = "";
  let turn: string | undefined;
  for (const line of lines) {
    const payload = line.payload ?? {};
    const at = time(line);
    if (line.type === "turn_context") {
      if (typeof payload.model === "string") model = payload.model;
      continue;
    }
    if (line.type !== "event_msg") continue;
    if (payload.type === "task_complete" && payload.turn_id === turn) {
      transcript.turnDone();
      continue;
    }
    if (payload.type === "turn_aborted" && payload.turn_id === turn) {
      transcript.stopped();
      continue;
    }
    if (payload.type !== "item_completed") continue;
    const item = payload.item ?? {};
    if (item.type === "UserMessage") {
      transcript.prompt(textOf(item.content) || "(empty message)", at);
      turn = payload.turn_id;
      continue;
    }
    if (payload.turn_id !== turn) continue;
    if (item.type === "AgentMessage") {
      const text = textOf(item.content);
      if (item.phase === "commentary")
        transcript.commentary(item.id, text, at);
      else transcript.text(item.id, text, at);
    } else {
      const activity = activityOf(item);
      if (activity) transcript.activity(activity, at);
    }
    transcript.model(model);
    if (typeof turn === "string") transcript.canCut(turn);
  }
  return transcript.done();
}
