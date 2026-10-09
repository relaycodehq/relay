import type { ChatPending } from "../../../../shared/projects";
import type { ContextReport } from "../../../../shared/context-report";
import type { SubagentDetail, SubagentRun } from "../../../../shared/subagents";
import { withTimeout } from "../../../util/timeout";
import { claudeContextReport } from "./context";
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
  if (!session || session.frames.ended)
    throw new Error("That agent has already finished.");
  const taskId = session.agents.taskId(id);
  if (!taskId)
    throw new Error(
      session.agents.detail(id)?.status === "running"
        ? "That agent isn't ready to stop yet. Try again shortly."
        : "That agent has already finished.",
    );
  await session.stream.stopTask(taskId);
}
/**
 * What fills the live session's window, counted by Claude Code as /context
 * does. It answers beside a running turn without holding it up; null once the
 * session is gone.
 */
export async function readClaudeContext(
  key: string,
): Promise<ContextReport | null> {
  const session = sessions.get(key);
  if (!session || session.frames.ended) return null;
  const usage = await withTimeout(
    session.stream.getContextUsage({ detail: "full" }),
    15000,
    "Claude did not count its context.",
  );
  return claudeContextReport(usage);
}
