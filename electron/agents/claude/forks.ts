// A skill with `context: fork` (e.g. /code-review) runs as a subagent that no
// Agent call started: its task_started has no tool_use_id, nothing it does
// streams while it works, and once it ends Claude Code replays its transcript
// under a made-up parent, `forked-command-<skill>`.
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type ForkStart = Extract<
  SDKMessage,
  { type: "system"; subtype: "task_started" }
>;

/** A forked skill starting, or nothing. */
export function forkStart(message: SDKMessage): ForkStart | undefined {
  if (message.type !== "system" || message.subtype !== "task_started") return;
  if (message.tool_use_id || message.ambient || message.skip_transcript) return;
  if (message.task_type && message.task_type !== "local_agent") return;
  return message;
}

/** The row, and the run, a forked skill shows as. */
export const forkId = (taskId: string) => `fork:${taskId}`;

const replayPrefix = "forked-command-";

/** The parent its replayed frames name: the skill's command without its arguments. */
const replayParent = (description: string) =>
  replayPrefix + description.trim().replace(/^\//, "").split(/\s+/)[0];

/** Which fork a replayed frame's made-up parent means. */
export class ForkParents {
  private byParent = new Map<string, string>();
  private latest?: string;

  start(message: ForkStart) {
    const id = forkId(message.task_id);
    this.byParent.set(replayParent(message.description), id);
    this.latest = id;
    return id;
  }

  /** Any other parent stays as it is. */
  resolve(parent: string | null | undefined): string | null {
    if (!parent?.startsWith(replayPrefix)) return parent ?? null;
    // The name is Claude Code's own; were it to change, the newest fork is the likeliest.
    return this.byParent.get(parent) ?? this.latest ?? parent;
  }
}
