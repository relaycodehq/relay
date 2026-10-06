// Claude Code keeps each session as `<config>/projects/<slug>/<id>.jsonl`,
// one entry per line, chained by `parentUuid`.
import { claudeActivity } from "../agents/activity";
import { eachLine, parsed } from "./scan";
import { Transcript, type Imported } from "./transcript";

/** Claude Code's folder name for a working folder (its `projects/` slug). */
export function claudeSlug(path: string) {
  const slug = path.replace(/[^a-zA-Z0-9]/g, "-");
  if (slug.length <= 200) return slug;
  let hash = 0;
  for (let i = 0; i < path.length; i++)
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  return `${slug.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

/**
 * Where a session ran and whether it came from the `claude` command in a
 * terminal, from the first fields that say so. They are matched in the raw
 * text: a long first prompt can leave its line unfinished in the head read.
 */
export function claudeOrigin(text: string) {
  const entrypoint = /"entrypoint":"([^"]*)"/.exec(text)?.[1];
  const cwd = /"cwd":("(?:[^"\\]|\\.)*")/.exec(text)?.[1];
  if (!entrypoint || !cwd) return;
  try {
    return {
      cwd: JSON.parse(cwd) as string,
      // Relay's own sessions, and `claude -p`, say "sdk-cli".
      terminal: entrypoint === "cli",
    };
  } catch {
    return;
  }
}

const WRAPPED = /^\s*<(local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|system-reminder)>/;
const INTERRUPTED = /^\[Request interrupted by user/;

/**
 * What the user typed in an entry, or undefined when it isn't a prompt: tool
 * results, notes Claude Code adds itself, and local commands' output.
 */
export function claudePrompt(entry: Record<string, any>): string | undefined {
  if (entry.type !== "user" || entry.isSidechain || entry.isMeta) return;
  if (entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return;
  const content = entry.message?.content;
  const parts: string[] = [];
  if (typeof content === "string") parts.push(content);
  else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === "tool_result")) return;
    for (const block of content)
      if (block?.type === "text" && typeof block.text === "string")
        parts.push(block.text);
      else if (block?.type === "image") parts.push("(image)");
  }
  const text = parts.join("\n").trim();
  if (!text || WRAPPED.test(text) || INTERRUPTED.test(text)) return;
  const command = /<command-name>\s*([^<]*)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1];
    return [command[1]!.trim(), args?.trim()].filter(Boolean).join(" ");
  }
  const bash = /^<bash-input>([\s\S]*)<\/bash-input>$/.exec(text);
  if (bash) return `!${bash[1]}`;
  return text;
}

/**
 * What the user typed while Claude was working: Claude Code keeps it as a
 * `queued_command` attachment, never as a user entry. Notifications from
 * background tasks and messages from other sessions queue the same way.
 */
export function claudeQueuedPrompt(entry: Record<string, any>) {
  const queued = entry.attachment;
  if (entry.type !== "attachment" || entry.isSidechain) return;
  if (queued?.type !== "queued_command" || queued.commandMode !== "prompt") return;
  if (queued.origin && queued.origin.kind !== "human") return;
  return claudePrompt({ type: "user", message: { content: queued.prompt } });
}

/** A session's name and how many prompts it holds, read in one pass. */
export async function claudeSummary(path: string) {
  let custom = "",
    ai = "",
    first = "",
    turns = 0;
  await eachLine(
    path,
    [
      '"type":"user"',
      '"type":"custom-title"',
      '"type":"ai-title"',
      '"type":"queued_command"',
    ],
    (line) => {
      const entry = parsed(line);
      if (!entry) return;
      if (entry.type === "custom-title" && typeof entry.customTitle === "string")
        custom = entry.customTitle;
      else if (entry.type === "ai-title" && typeof entry.aiTitle === "string")
        ai = entry.aiTitle;
      else {
        const prompt = claudePrompt(entry) ?? claudeQueuedPrompt(entry);
        if (!prompt) return;
        turns++;
        first ||= prompt;
      }
    },
  );
  return { title: (custom || ai || first).trim(), turns };
}

const time = (entry: Record<string, any>) => {
  const at = Date.parse(entry.timestamp);
  return Number.isFinite(at) ? at : 0;
};

/**
 * The conversation on the session's current branch: walked back from its
 * last entry by `parentUuid`, and past a compaction by `logicalParentUuid`,
 * so a rewound branch doesn't show. Every entry with a uuid is a link:
 * attachments and system notes sit in the chain between turns.
 */
export async function claudeHistory(path: string, session: string) {
  const byId = new Map<string, Record<string, any>>();
  let last: Record<string, any> | undefined;
  await eachLine(path, ['"uuid"'], (line) => {
    const entry = parsed(line);
    if (typeof entry?.uuid !== "string") return;
    byId.set(entry.uuid, entry);
    if (!entry.isSidechain) last = entry;
  });
  const chain: Record<string, any>[] = [];
  const seen = new Set<string>();
  for (let entry = last; entry && !seen.has(entry.uuid); ) {
    seen.add(entry.uuid);
    chain.push(entry);
    entry = byId.get(entry.parentUuid ?? entry.logicalParentUuid);
  }
  chain.reverse();
  return claudeTranscript(chain, session);
}

export function claudeTranscript(
  chain: Record<string, any>[],
  session: string,
): Imported {
  const transcript = new Transcript("claude", session);
  let endedClean = false;
  for (const entry of chain) {
    const at = time(entry);
    const queued = claudeQueuedPrompt(entry);
    if (queued) {
      // Typed mid-turn, it doesn't finish the turn it interrupts.
      if (endedClean) transcript.turnDone();
      endedClean = false;
      transcript.prompt(queued, at);
    } else if (entry.type === "user") {
      endedClean = false;
      const prompt = claudePrompt(entry);
      if (prompt) {
        transcript.turnDone();
        transcript.prompt(prompt, at);
        continue;
      }
      const content = entry.message?.content;
      const text = typeof content === "string" ? content : "";
      if (INTERRUPTED.test(text)) transcript.stopped();
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "text" && INTERRUPTED.test(block.text ?? ""))
          transcript.stopped();
        if (block?.type !== "tool_result") continue;
        const output =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .flatMap((p: any) =>
                    p?.type === "text" && typeof p.text === "string"
                      ? [p.text]
                      : [],
                  )
                  .join("\n")
              : "";
        transcript.finished(String(block.tool_use_id).slice(0, 180), {
          status: block.is_error ? "failed" : "complete",
          ...(output ? { detail: output.slice(-8000) } : {}),
        });
      }
    } else if (entry.type === "assistant") {
      endedClean = false;
      const message = entry.message ?? {};
      if (message.model === "<synthetic>" || entry.isApiErrorMessage) continue;
      const blocks = Array.isArray(message.content) ? message.content : [];
      let called = false;
      for (const block of blocks)
        if (block?.type === "text" && typeof block.text === "string")
          transcript.text(entry.uuid, block.text, at);
        else if (block?.type === "tool_use" && typeof block.id === "string") {
          called = true;
          transcript.activity(
            claudeActivity(block.id, String(block.name ?? "Tool"), block.input),
            at,
          );
        }
      if (typeof message.model === "string") transcript.model(message.model);
      if (!called && blocks.some((b: any) => b?.type === "text")) {
        transcript.canCut(entry.uuid);
        endedClean = true;
      }
    }
  }
  // The session's last entry is an answer with nothing after it: the turn finished.
  if (endedClean) transcript.turnDone();
  return transcript.done();
}
