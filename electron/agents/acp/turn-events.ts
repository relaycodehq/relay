import { randomUUID } from "node:crypto";
import type { AskedQuestion } from "../../../shared/asked-questions";
import type { AgentOptions } from "../types";
import { answerLimitError, TurnText } from "../turn-kit";
import { mcpCall } from "../activity";
import {
  AntigravitySubagents,
  antigravityMcp,
  antigravitySteps,
  antigravitySubagents,
  geminiCache,
  updatesSteps,
  TextSpeed,
} from "../antigravity";
import { acpActivity, acpEdits, checklistSteps, planText, type PlanEntry } from "./activity";
import type { AcpProfile } from "./profiles";
import { parseUpdate, type AcpToolCall } from "./protocol";
import { currentOf } from "./settings";
import type { AcpAgent } from "./sessions";

/** What an ACP agent says about its session during one turn, put to the thread as it comes. */
export class AcpTurnEvents {
  readonly turn: TurnText;
  /** The tool calls so far, each as its updates filled it in. */
  readonly calls = new Map<
    string,
    Partial<AcpToolCall> & { toolCallId: string }
  >();
  readonly subagents: AntigravitySubagents | undefined;
  /** A turn picked up again hears what it missed all at once, so it can't be timed. */
  readonly speed: TextSpeed | undefined;
  /** Whether this turn has shown the agent's checklist. */
  private checklistShown = false;
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
    this.speed =
      profile.provider === "antigravity" && options.job.kind !== "adopt"
        ? new TextSpeed()
        : undefined;
    this.subagents =
      profile.provider === "antigravity" && key
        ? new AntigravitySubagents(antigravitySubagents.open(key))
        : undefined;
  }

  /** How many calls went through. */
  get completedCalls() {
    return [...this.calls.values()].filter((c) => c.status === "completed")
      .length;
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
    const mcp = this.profile.provider === "antigravity" && antigravityMcp(call);
    const activity = {
      ...acpActivity(call),
      ...(mcp && mcpCall(mcp.server, mcp.tool)),
    };
    if (!this.asked.has(call.toolCallId))
      return this.options.onActivity?.(activity);
    const answers = this.asked.get(call.toolCallId);
    this.options.onActivity?.({
      ...activity,
      label: "request_user_input",
      ...(answers ? { questionAnswers: answers } : {}),
    });
  }

  /** The agent's checklist, as one row kept up to date; an empty one clears it. */
  private showChecklist(entries: PlanEntry[]) {
    const detail = planText(entries);
    const over = answerLimitError(detail.length);
    if (over) return this.halt(over);
    this.checklistShown = true;
    this.options.onActivity?.({
      id: `${this.profile.provider}-plan`,
      kind: "tool",
      // Written down, the update is done, whatever steps are left.
      status: "complete",
      label: "Updated progress",
      detail,
      checklist: checklistSteps(entries) ?? [],
    });
    return detail;
  }

  /** Antigravity's finished `update_steps` call: its list, or the call itself where the list can't be read. */
  private showSteps(call: Partial<AcpToolCall> & { toolCallId: string }) {
    const steps = antigravitySteps(call);
    if (steps) this.showChecklist(steps);
    else this.show(call);
  }

  /** While Antigravity compacts, it reports the size from before; the next turn says the new one. */
  /** When the request that just reported touched the prompt cache, where Relay knows its lifetime. */
  private promptCache() {
    if (this.profile.provider !== "antigravity") return {};
    // Default leaves the choice empty; the session says what it runs.
    const settings = this.agent.session?.settings;
    const model =
      this.options.choice.model || (settings && currentOf(settings).model);
    const cache = geminiCache(model);
    return cache ? { cache } : {};
  }

  private sizeIsOld() {
    return (
      this.options.job.kind === "compact" &&
      this.profile.provider === "antigravity"
    );
  }

  hear = (raw: unknown) => {
    const update = parseUpdate(raw);
    if (!update) return;
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (update.content.type !== "text") return;
        this.speed?.text(update.content.text ?? "");
        this.turn.add(update.content.text ?? "");
        const over = answerLimitError(this.turn.size);
        if (over && !this.stopped()) this.halt(over);
        return;
      }
      case "agent_thought_chunk":
        this.speed?.pause();
        return;
      case "tool_call":
      case "tool_call_update": {
        this.speed?.pause();
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
        this.speed?.call(call);
        const listsSteps =
          this.profile.provider === "antigravity" && updatesSteps(call);
        if (listsSteps && call.status !== "failed") {
          if (!known) this.turn.toNewParagraph();
          // Refused lists fail, so one only counts once its call completed.
          if (call.status === "completed") this.showSteps(call);
          return;
        }
        this.subagents?.update(call);
        if (!known) this.turn.toCommentary();
        this.show(call);
        const edits = acpEdits(call);
        if (edits.length) this.options.onEdit?.(edits);
        return;
      }
      case "plan": {
        // Some agents send an empty plan as a matter of course; it clears only a list this turn showed.
        if (!update.entries.length && !this.checklistShown) return;
        // The steps the agent keeps, which in Plan mode are the plan it proposes.
        const detail = this.showChecklist(update.entries);
        if (detail && this.options.interactionMode === "plan")
          this.options.onPlan?.(detail);
        return;
      }
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
        if (!this.sizeIsOld())
          this.options.onContext?.({
            usedTokens: update.used,
            ...(update.size ? { maxTokens: update.size } : {}),
            ...this.promptCache(),
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
