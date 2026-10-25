import { randomUUID } from "node:crypto";
import type { AskedQuestion } from "../../../shared/asked-questions";
import type { AgentOptions } from "../types";
import { answerLimitError, TurnText } from "../turn-kit";
import { AntigravityBatches, antigravityBatches } from "../antigravity";
import { acpActivity, acpEdits, planText } from "./activity";
import type { AcpProfile } from "./profiles";
import { parseUpdate, type AcpToolCall } from "./protocol";
import type { AcpAgent } from "./sessions";

/** What an ACP agent says about its session during one turn, put to the thread as it comes. */
export class AcpTurnEvents {
  readonly turn: TurnText;
  /** The tool calls so far, each as its updates filled it in. */
  readonly calls = new Map<
    string,
    Partial<AcpToolCall> & { toolCallId: string }
  >();
  readonly batches: AntigravityBatches | undefined;
  /** Calls that asked the user through a form, with the answers once they're in. */
  private asked = new Map<string, AskedQuestion[] | undefined>();

  constructor(
    private profile: AcpProfile,
    private options: AgentOptions,
    private agent: AcpAgent,
    key: string | undefined,
    /** Ends the turn with `error`. */
    private halt: (error: Error) => void,
    private stopped: () => boolean,
  ) {
    this.turn = new TurnText(
      options.onText,
      options.onCommentary,
      profile.provider,
    );
    this.batches =
      profile.provider === "antigravity" && key
        ? new AntigravityBatches(antigravityBatches.open(key))
        : undefined;
  }

  /**
   * Shows the call asking the user as a question, or a row of its own when
   * the agent named none. The returned function records their answers, or
   * that they gave none.
   */
  asking = (toolCallId?: string) => {
    const known = toolCallId ? this.calls.get(toolCallId) : undefined;
    if (!known) {
      const row = {
        id: `question:${randomUUID()}`,
        kind: "tool",
        label: "request_user_input",
      } as const;
      this.options.onActivity?.({ ...row, status: "running" });
      return (answers?: AskedQuestion[]) =>
        this.options.onActivity?.({
          ...row,
          ...(answers
            ? { status: "complete", questionAnswers: answers }
            : { status: "stopped" }),
        });
    }
    const id = known.toolCallId;
    this.asked.set(id, undefined);
    this.show(known);
    return (answers?: AskedQuestion[]) => {
      this.asked.set(id, answers);
      this.show(this.calls.get(id) ?? known);
    };
  };

  private show(call: Partial<AcpToolCall> & { toolCallId: string }) {
    const activity = acpActivity(call);
    if (!this.asked.has(call.toolCallId))
      return this.options.onActivity?.(activity);
    const answers = this.asked.get(call.toolCallId);
    this.options.onActivity?.({
      ...activity,
      label: "request_user_input",
      ...(answers ? { questionAnswers: answers } : {}),
    });
  }

  hear = (raw: unknown) => {
    const update = parseUpdate(raw);
    if (!update) return;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content.type !== "text") return;
        this.turn.add(update.content.text ?? "");
        const over = answerLimitError(this.turn.size);
        if (over && !this.stopped()) this.halt(over);
        return;
      }
      case "agent_thought_chunk":
        return;
      case "tool_call":
      case "tool_call_update": {
        if (
          this.profile.provider === "antigravity" &&
          update.toolCallId.startsWith("interaction_")
        )
          return;
        if (
          (this.options.job.kind === "helper" ||
            this.options.job.kind === "compact") &&
          this.profile.provider === "antigravity"
        ) {
          this.halt(
            new Error(
              "Antigravity attempted tool work during a text-only helper or compaction job.",
            ),
          );
          return;
        }
        const { sessionUpdate: _, ...fields } = update;
        const known = this.calls.get(update.toolCallId);
        const call = {
          ...known,
          ...Object.fromEntries(
            Object.entries(fields).filter(([, v]) => v != null),
          ),
        } as Partial<AcpToolCall> & { toolCallId: string };
        this.calls.set(update.toolCallId, call);
        this.batches?.update(call);
        if (!known) this.turn.toCommentary();
        this.show(call);
        const edits = acpEdits(call);
        if (edits.length) this.options.onEdit?.(edits);
        return;
      }
      case "plan":
        if (update.entries.length) {
          const detail = planText(update.entries);
          const over = answerLimitError(detail.length);
          if (over) {
            this.halt(over);
            return;
          }
          this.options.onActivity?.({
            id: `${this.profile.provider}-plan`,
            kind: "tool",
            status: update.entries.some((e) => e.status === "in_progress")
              ? "running"
              : "complete",
            label: "Updated the plan",
            detail,
          });
          if (this.options.interactionMode === "plan")
            this.options.onPlan?.(detail);
        }
        return;
      case "current_mode_update": {
        const modes = this.agent.session?.settings.modes;
        if (modes) modes.currentModeId = update.currentModeId;
        return;
      }
      case "config_option_update":
        if (this.agent.session)
          this.agent.session.settings.configOptions = update.configOptions;
        return;
      case "session_info_update":
        if (update.title) this.options.onTitle?.(update.title);
        return;
      case "usage_update":
        this.options.onContext?.({
          usedTokens: update.used,
          ...(update.size ? { maxTokens: update.size } : {}),
        });
        // The session's cost so far, which OpenCode only reports once a
        // turn ends; a turn counts what it added since the last report.
        if (
          this.agent.session &&
          update.cost &&
          (!update.cost.currency || update.cost.currency === "USD")
        ) {
          const before = this.agent.session.cost;
          this.agent.session.cost = update.cost.amount;
          const spent = before === undefined ? 0 : update.cost.amount - before;
          if (spent > 0) this.options.onCost?.(spent);
        }
        return;
    }
  };
}
