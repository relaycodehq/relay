import type { ChatPending } from "../../../shared/projects";
import type { SubagentDetail, SubagentRun } from "../../../shared/subagents";
import { sessions } from "./session";

/** What Claude left running that will start its next turn, while its session lives. */
export function claudePending(key: string): ChatPending[] {
  const session = sessions.get(key);
  if (!session || session.frames.ended) return [];
  return session.work.list();
}
/** Stops a background task; Claude hears it stopped and usually says so. */
export async function stopClaudeTask(key: string, taskId: string) {
  const session = sessions.get(key);
  if (!session?.work.has(taskId) || session.frames.ended)
    throw new Error("That work has already finished.");
  await session.stream.stopTask(taskId);
}
/** The subagents a thread's live session started, running or back. */
export function claudeAgents(key: string): SubagentRun[] {
  return sessions.get(key)?.agents.list() ?? [];
}
export function claudeAgentRun(
  key: string,
  id: string,
): SubagentDetail | undefined {
  return sessions.get(key)?.agents.detail(id);
}
/** Stops one agent, foreground or background; Claude hears it was stopped. */
export async function stopClaudeAgent(key: string, id: string) {
  const session = sessions.get(key);
  const taskId = session?.agents.taskId(id);
  if (!session || !taskId || session.frames.ended)
    throw new Error("That agent has already finished.");
  await session.stream.stopTask(taskId);
}
