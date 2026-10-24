import type { SessionMessageInfo } from "@opencode/client";
import type { AgentActivity } from "../../../shared/projects";
import { TurnEnd } from "../turn-kit";
import type { AgentOptions } from "../types";
import { nativeCall } from "./activity";

/**
 * A turn OpenCode started by itself between Relay's prompts, as it does when
 * a background shell command it launched ends. It runs in the ACP process's
 * own server, so neither ACP nor the service's events mention it: its saved
 * messages make the answer, which Relay shows as an `adopt` turn. What came
 * before Relay picked it up is kept and shown first.
 */
export class SelfTurn {
  readonly end = new TurnEnd<void>();
  private blocks = new Map<string, string>();
  private activities = new Map<string, AgentActivity>();
  private edits: string[] = [];
  private options?: AgentOptions;
  /** Its answers so far, for billing once it's shown. */
  readonly answers = new Map<
    string,
    Extract<SessionMessageInfo, { type: "assistant" }>
  >();

  /** `from`: when its first message was saved. */
  constructor(readonly from: number) {}

  get adopted() {
    return !!this.options;
  }

  get text() {
    return [...this.blocks.values()].join("\n\n");
  }

  /** Takes in one of its saved messages, again as it grows. */
  read(message: SessionMessageInfo) {
    if (message.type === "idle") {
      if (message.outcome === "succeeded") this.end.succeed();
      else
        this.end.fail(
          new Error(
            message.error?.message ??
              (message.outcome === "interrupted"
                ? "Cancelled by you."
                : "OpenCode's turn failed."),
          ),
        );
      return;
    }
    if (message.type !== "assistant") return;
    this.answers.set(message.id, message);
    for (const [ordinal, part] of message.content.entries()) {
      if (part.type === "text")
        this.said(`${message.id}:${ordinal}`, part.text);
      if (part.type === "tool") this.called(nativeCall(part));
    }
  }

  show(options: AgentOptions) {
    this.options = options;
    for (const activity of this.activities.values())
      options.onActivity?.(activity);
    if (this.edits.length) options.onEdit?.(this.edits);
    if (this.blocks.size) options.onText(this.text);
  }

  private said(key: string, text: string) {
    if (this.blocks.get(key) === text) return;
    this.blocks.set(key, text);
    this.options?.onText(this.text);
  }

  private called({ activity, edits }: ReturnType<typeof nativeCall>) {
    const known = this.activities.get(activity.id);
    if (known && JSON.stringify(known) === JSON.stringify(activity)) return;
    this.activities.set(activity.id, activity);
    this.options?.onActivity?.(activity);
    if (activity.status !== "complete" || !edits.length) return;
    this.edits.push(...edits);
    this.options?.onEdit?.(edits);
  }
}

/** The background shell commands `messages` launched, and those that reported back. */
export function backgroundJobs(messages: SessionMessageInfo[]) {
  const launched = new Set<string>();
  const reported = new Set<string>();
  for (const message of messages) {
    if (message.type === "synthetic") {
      const job = message.metadata?.shellID ?? message.metadata?.jobID;
      if (typeof job === "string") reported.add(job);
    }
    if (message.type !== "assistant") continue;
    for (const part of message.content)
      if (
        part.type === "tool" &&
        part.state.status !== "streaming" &&
        part.state.input?.background === true &&
        "metadata" in part.state &&
        typeof part.state.metadata?.shellID === "string"
      )
        launched.add(part.state.metadata.shellID);
  }
  return { launched, reported };
}
