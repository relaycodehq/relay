import {
  handoffBlocked,
  type HandoffChatMethod,
  type HandoffTarget,
} from "../../shared/handoff";
import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { toolText, type RelayToolArgs } from "../relay-mcp";
import { refused, type Approvals } from "./approvals";
import { drivenThread } from "./driven-thread";
import type { ProjectAccess } from "./project-access";
import type { ThreadReads } from "./thread-reads";

/** Moving threads to the user's other computers, as the thread header does. */
export interface ThreadHandoffs {
  /** Whether the call is for a thread live on another computer, so runs there. */
  forwards(method: string, args: unknown[]): boolean;
  forward(method: HandoffChatMethod, args: unknown[]): Promise<unknown>;
  targets(chatId: string): Promise<HandoffTarget[]>;
  handOff(chatId: string, computerId: string): Promise<void>;
  bringBack(chatId: string): Promise<void>;
  /** Once the handoff or bringing back under way is over, however it went. */
  finished(chatId: string): Promise<void>;
}

/** A paired computer that has the thread's repository and can take it. */
type TakingComputer = HandoffTarget & Required<Pick<HandoffTarget, "project">>;

/**
 * The paired computer a handoff goes to: the one `to` names, or else the
 * only one that can take the thread. Otherwise, why there's none to pick.
 */
function pickComputer(
  targets: HandoffTarget[],
  to: string | undefined,
): { ok: true; computer: TakingComputer } | { ok: false; problem: string } {
  const candidates = to
    ? targets.filter((t) => t.name.toLowerCase() === to.toLowerCase())
    : targets.filter((t) => t.project);
  const only = candidates.length === 1 ? candidates[0]! : undefined;
  if (only?.project)
    return { ok: true, computer: { ...only, project: only.project } };
  if (only) return { ok: false, problem: `${only.name} can't take it.` };
  if (to) return { ok: false, problem: `No paired computer is named "${to}".` };
  if (candidates.length)
    return {
      ok: false,
      problem: "Several computers can take it; name one in `to`.",
    };
  return { ok: false, problem: "No paired computer can take it now." };
}

/** Each paired computer and whether it can take the thread, for the agent to pick from. */
function listComputers(targets: HandoffTarget[]) {
  return targets
    .map(
      (t) =>
        `- ${t.name}: ${t.project ? `can take it, into ${t.project.name}` : t.problem}`,
    )
    .join("\n");
}

/** hand_off_thread: moving a thread to another of the user's computers and back. */
export class HandoffTool {
  constructor(
    private reads: Pick<ThreadReads, "children" | "thread">,
    private projects: Pick<ProjectAccess, "real">,
    private approvals: Approvals,
    private handoffs: ThreadHandoffs | undefined,
  ) {}

  /**
   * Hands a thread to another computer, or brings it back with `to` "here",
   * as the thread header does. The user always confirms: the agent there
   * runs on what's there, and the thread's agent here stops for its note.
   */
  async handOff(
    lead: ProjectChat,
    { id, to }: RelayToolArgs<"hand_off_thread">,
    signal: AbortSignal,
  ) {
    const handoffs = this.handoffs;
    if (!handoffs)
      return toolText(
        "This Relay can't hand threads to other computers.",
        true,
      );
    const { summary, chat, where } = await drivenThread(
      this.reads,
      this.projects,
      lead,
      id,
    );
    if (to?.toLowerCase() === "here")
      return this.bringBack(lead, handoffs, summary, chat, where, signal);
    if (summary.sentTo)
      return toolText(`It's on ${summary.sentTo.computer} already.`, true);
    const blocked = handoffBlocked(summary);
    if (blocked) return toolText(blocked, true);
    const targets = await handoffs.targets(id);
    if (!targets.length)
      return toolText(
        "No other computer is paired with this Relay. The user pairs one in Settings → Computers.",
        true,
      );
    const pick = pickComputer(targets, to);
    if (!pick.ok)
      return toolText(`${pick.problem}\n${listComputers(targets)}`, true);
    const target = pick.computer;
    const approved = await this.approvals.ask(
      lead,
      `Hand “${chat.title}”${where} off to ${target.name}?`,
      `Its agent stops and writes a handoff note, everything in its worktree is committed, and it carries on in ${target.project.name} on ${target.name}. Ignored files such as .env stay here.`,
      signal,
      true,
    );
    if (!approved) return refused("hand it off");
    await handoffs.handOff(id, target.id);
    await handoffs.finished(id);
    const sentTo = (await this.reads.thread(id)).summary.sentTo;
    if (!sentTo || sentTo.error)
      return toolText(
        `It didn't go to ${target.name}${sentTo?.error ? `: ${sentTo.error}` : "."}`,
        true,
      );
    return toolText(
      sentTo.live
        ? `It runs on ${target.name} now. send_to_thread, stop_thread, read_thread and wait_for_threads reach it there.`
        : `It's on ${target.name} now. That Relay is too old to follow from here, so it can't be messaged until it's brought back.`,
    );
  }

  private async bringBack(
    lead: ProjectChat,
    handoffs: ThreadHandoffs,
    summary: ChatSummary,
    chat: ProjectChat,
    where: string,
    signal: AbortSignal,
  ) {
    const { sentTo } = summary;
    if (!sentTo) return toolText("It's here already.", true);
    const approved = await this.approvals.ask(
      lead,
      `Bring “${chat.title}”${where} back from ${sentTo.computer}?`,
      `Its work on ${sentTo.computer} stops, the agent there writes a handoff note and commits, and the thread carries on here.`,
      signal,
      true,
    );
    if (!approved) return refused("bring it back");
    await handoffs.bringBack(chat.id);
    await handoffs.finished(chat.id);
    const after = (await this.reads.thread(chat.id)).summary.sentTo;
    if (after)
      return toolText(
        `It didn't come back from ${sentTo.computer}${after.error ? `: ${after.error}` : "."}`,
        true,
      );
    return toolText("It's back here.");
  }
}
