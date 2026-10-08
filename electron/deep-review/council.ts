import { agentName, type AgentProvider } from "../../shared/agents";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import type { ModelChoice } from "../../shared/settings";
import { hasCouncilReport } from "../../shared/council";

/** Council members read and reason but never change files, and none of them stops to ask. */
export const councilTurn = {
  runtimeMode: "approval-required",
  interactionMode: "default",
} as const;

/** A member thread's latest assistant message; nothing if the thread can't be loaded. */
export async function lastAnswer(
  host: { load(id: string): Promise<ProjectChat> },
  chatId: string,
) {
  const chat = await host.load(chatId).catch(() => undefined);
  return (
    chat && [...chat.messages].reverse().find((m) => m.role === "assistant")
  );
}

/** The slots whose member didn't finish its answer, to run again. */
export async function unfinishedSlots(
  host: { load(id: string): Promise<ProjectChat> },
  members: { chatId: string }[],
) {
  const slots: number[] = [];
  for (const [slot, m] of members.entries())
    if (!hasCouncilReport(await lastAnswer(host, m.chatId))) slots.push(slot);
  return slots;
}

/**
 * Why the members' answers can't go to the lead: one stopped along the way,
 * say by Relay closing, so it waits for Resume; or none finished.
 */
export function halted(answers: (ChatMessage | undefined)[]) {
  if (answers.some((a) => a?.status === "cancelled")) return "stopped";
  if (!answers.some(hasCouncilReport)) return "failed";
}

/** How a member reads to the lead. */
export function memberLabel(member: {
  provider: AgentProvider;
  choice: ModelChoice;
}) {
  const model = member.choice.model || "default model";
  const effort = member.choice.reasoningEffort || "default effort";
  return `${agentName(member.provider)} (${model}, ${effort})`;
}

/**
 * Starts every slot's turn. Members that never started count as finished, so
 * `someFailed` lets the rest hand over; only when none started is it an error.
 */
export async function startSlots(
  slots: number[],
  start: (slot: number) => Promise<unknown>,
  someFailed: () => Promise<unknown>,
) {
  const failures = await Promise.all(
    slots.map(async (slot) => {
      try {
        await start(slot);
        return undefined;
      } catch (e) {
        return e;
      }
    }),
  );
  if (failures.some(Boolean)) await someFailed();
  const failure = failures.find(Boolean);
  if (failures.every(Boolean)) throw failure;
}
