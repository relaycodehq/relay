// Fake Claude Code and Codex session files, shaped like the ones the CLIs
// write (Claude Code 2.1, codex-cli 0.160), for tests that must never read
// the real ~/.claude or ~/.codex.
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeSlug } from "../../electron/terminal-sessions/claude";

type Entry = Record<string, unknown>;

const jsonl = (entries: Entry[]) =>
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

/** Writes `<home>/projects/<slug>/<id>.jsonl`; `ago` ms back sets its mtime. */
export async function writeClaudeSession(
  home: string,
  cwd: string,
  id: string,
  entries: Entry[],
  { entrypoint = "cli", ago = 0 } = {},
) {
  const dir = join(home, "projects", claudeSlug(cwd));
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  const at = Date.parse("2026-10-06T09:00:00Z");
  await writeFile(
    path,
    jsonl(
      entries.map((e, i) => ({
        cwd,
        sessionId: id,
        entrypoint,
        version: "2.1.291",
        timestamp: new Date(at + i * 1000).toISOString(),
        isSidechain: false,
        ...e,
      })),
    ),
  );
  if (ago) await age(path, ago);
  return path;
}

/**
 * A Claude Code conversation: each turn a prompt, a Bash call and its
 * answer, with the attachments and notes Claude Code chains in between.
 * Uuids are `<type>-<index>`; turn i's answer is `assistant-${8 * i + 6}`.
 */
export function claudeTurns(turns: { prompt: string; answer: string }[]) {
  const entries: Entry[] = [];
  let parent: string | null = null;
  const add = (e: Entry) => {
    const uuid = `${e.type}-${entries.length}`;
    entries.push({ ...e, uuid, parentUuid: parent });
    parent = uuid;
    return uuid;
  };
  turns.forEach(({ prompt, answer }, i) => {
    add({ type: "user", message: { role: "user", content: prompt } });
    add({
      type: "attachment",
      attachment: { type: "total_tokens_reminder", text: "reminder" },
    });
    add({
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
        role: "assistant",
        content: [{ type: "text", text: `Looking (${i}).` }],
      },
    });
    add({
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
        content: [
          {
            type: "tool_use",
            id: `toolu_${i}`,
            name: "Bash",
            input: { command: `ls ${i}` },
          },
        ],
      },
    });
    add({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `toolu_${i}`,
            content: `out ${i}`,
          },
        ],
      },
    });
    add({
      type: "attachment",
      attachment: { type: "hook_additional_context", content: ["hook"] },
    });
    add({
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
        content: [{ type: "text", text: answer }],
      },
    });
    add({ type: "system", subtype: "turn_duration", durationMs: 1000 });
  });
  return entries;
}

/** A prompt typed while Claude was working, chained after `parent`. */
export function claudeQueued(
  uuid: string,
  parent: string,
  prompt: string,
  origin?: { kind: string },
): Entry {
  return {
    type: "attachment",
    uuid,
    parentUuid: parent,
    attachment: {
      type: "queued_command",
      commandMode:
        origin?.kind === "task-notification" ? "task-notification" : "prompt",
      prompt,
      ...(origin ? { origin } : {}),
    },
  };
}

/** Writes a Codex rollout under `<home>/sessions/<today>/`. */
export async function writeCodexSession(
  home: string,
  cwd: string,
  id: string,
  turns: { prompt: string; answer: string; done?: boolean }[],
  {
    source = "vscode" as string | object,
    originator = "codex-tui",
    ago = 0,
    name = "",
  } = {},
) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dir = join(
    home,
    "sessions",
    String(now.getFullYear()),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  );
  await mkdir(dir, { recursive: true });
  const at = Date.parse("2026-10-06T09:00:00Z");
  let n = 0;
  const line = (type: string, payload: Entry) => ({
    timestamp: new Date(at + n++ * 1000).toISOString(),
    type,
    payload,
  });
  const lines: Entry[] = [
    line("session_meta", {
      id,
      cwd,
      source,
      originator,
      cli_version: "0.160.1",
      base_instructions: { text: "x".repeat(20_000) },
    }),
  ];
  turns.forEach(({ prompt, answer, done = true }, i) => {
    const turn = `turn-${i}`;
    const item = (item: Entry) =>
      line("event_msg", { type: "item_completed", turn_id: turn, item });
    lines.push(
      line("turn_context", { turn_id: turn, model: "gpt-5.5-codex" }),
      item({
        type: "UserMessage",
        id: `u${i}`,
        content: [{ type: "Text", text: prompt }],
      }),
      item({
        type: "AgentMessage",
        id: `c${i}`,
        phase: "commentary",
        content: [{ type: "Text", text: `Checking (${i}).` }],
      }),
      item({
        type: "CommandExecution",
        id: `cmd${i}`,
        command: ["/bin/zsh", "-lc", `rg guard ${i}`],
        aggregated_output: `hit ${i}`,
        exit_code: 0,
        status: "completed",
      }),
      item({
        type: "AgentMessage",
        id: `a${i}`,
        phase: "final_answer",
        content: [{ type: "Text", text: answer }],
      }),
    );
    if (done)
      lines.push(line("event_msg", { type: "task_complete", turn_id: turn }));
  });
  const path = join(dir, `rollout-2026-10-06T09-00-00-${id}.jsonl`);
  await writeFile(path, jsonl(lines));
  if (name)
    await writeFile(
      join(home, "session_index.jsonl"),
      JSON.stringify({
        id,
        thread_name: name,
        updated_at: new Date().toISOString(),
      }) + "\n",
      { flag: "a" },
    );
  if (ago) await age(path, ago);
  return path;
}

async function age(path: string, ago: number) {
  const when = new Date(Date.now() - ago);
  await utimes(path, when, when);
}
