import type { AgentActivity } from "../../../shared/projects";

/** A tool call as the worker forwards it: the SDK's, cut down (see `slim` in worker.ts). */
export interface CursorCall {
  type: string;
  args?: Record<string, unknown>;
  result?: {
    status?: string;
    exitCode?: number;
    output?: string;
    error?: string;
  };
}

const text = (call: CursorCall, key: string) =>
  typeof call.args?.[key] === "string" ? (call.args[key] as string).trim() : "";

/** Every file a Cursor tool call writes. */
export function cursorEdits(call: CursorCall): string[] {
  if (call.type !== "write" && call.type !== "edit" && call.type !== "delete")
    return [];
  const path = text(call, "path");
  return path ? [path] : [];
}

/** The plan Cursor wrote, when this call is the one that writes it. */
export function cursorPlan(call: CursorCall): string | undefined {
  return call.type === "createPlan"
    ? text(call, "plan") || undefined
    : undefined;
}

/** Name a tool call by what it touched, not by the tool or its raw arguments. */
export function cursorActivity(
  callId: string,
  call: CursorCall,
  done: boolean,
): AgentActivity | undefined {
  const status: AgentActivity["status"] = !done
    ? "running"
    : call.result?.status === "error"
      ? "failed"
      : "complete";
  const make = (
    kind: AgentActivity["kind"],
    label: string,
    detail?: string,
  ): AgentActivity => ({
    id: callId.slice(0, 180),
    status,
    kind,
    label: (label || call.type).slice(0, 500),
    ...(detail ? { detail: detail.slice(-8000) } : {}),
  });
  switch (call.type) {
    case "shell":
      return make(
        "command",
        text(call, "command"),
        call.result?.output || call.result?.error,
      );
    case "write":
    case "edit":
    case "delete":
      return make("file", text(call, "path"), call.result?.error);
    case "read":
      return make("read", text(call, "path"));
    case "grep":
      return make(
        "search",
        [
          text(call, "pattern"),
          text(call, "path") && `in ${text(call, "path")}`,
        ]
          .filter(Boolean)
          .join(" "),
      );
    case "glob":
      return make("search", text(call, "globPattern"));
    case "ls":
      return make("search", text(call, "path") || "Listed files");
    case "semSearch":
      return make("search", text(call, "query"));
    case "task":
      return make("agent", text(call, "description"));
    case "mcp":
      return make(
        "tool",
        [text(call, "providerIdentifier"), text(call, "toolName")]
          .filter(Boolean)
          .join(" "),
      );
    case "updateTodos":
      return make("tool", "Updated the plan");
    case "readLints":
      return make("tool", "Checked lints");
    // Shown as the plan, not as a call.
    case "createPlan":
      return undefined;
  }
  return make("tool", call.type);
}

/**
 * The text of a turn. What Cursor says before a tool call is commentary on
 * the way; only what follows the last call is the answer.
 */
export class TurnText {
  private parts: { id: string; text: string; commentary: boolean }[] = [];
  private count = 0;

  constructor(
    private readonly onText: (text: string) => void,
    private readonly onCommentary?: (id: string, text: string | null) => void,
    /** Distinguishes this turn's commentary ids from another's. */
    private readonly prefix = "cursor",
  ) {}

  add(delta: string) {
    if (!delta) return;
    const last = this.parts.at(-1);
    if (last && !last.commentary) last.text += delta;
    else
      this.parts.push({
        id: `${this.prefix}-${this.count++}`,
        text: delta,
        commentary: false,
      });
    this.publish();
  }

  /** A tool call starts: the text so far was commentary. */
  toCommentary() {
    for (const part of this.parts) {
      if (part.commentary || !part.text.trim()) continue;
      part.commentary = true;
      this.onCommentary?.(part.id, part.text.slice(0, 12000));
    }
    this.publish();
  }

  /** Steering was read: what came before it is history, not the answer. */
  reset() {
    this.toCommentary();
    for (const part of this.parts) this.onCommentary?.(part.id, null);
    this.parts = [];
    this.publish();
  }

  answer() {
    return this.parts
      .filter((part) => !part.commentary && part.text.trim())
      .map((part) => part.text)
      .join("\n\n");
  }

  /** How long the answer shown is. */
  get size() {
    return this.shown.length;
  }

  private shown = "";
  private publish() {
    const next = this.answer();
    if (next === this.shown) return;
    this.shown = next;
    this.onText(next);
  }
}
