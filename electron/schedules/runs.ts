// One run of a schedule: the thread it starts or carries on, the prompt
// Relay sends there, and how its answer ended.
import { randomUUID } from "node:crypto";
import { fitModel } from "../../shared/model-fit";
import {
  projectChatSendSchema,
  type ChatMessage,
  type ChatScope,
  type ChatWorkspace,
  type ProjectChat,
  type ProjectChatSend,
} from "../../shared/projects";
import {
  SCRATCHPAD_SCHEDULE,
  type Schedule,
  type ScheduleRun,
} from "../../shared/schedules";
import { sliceWhole } from "../../shared/truncate";

/** What a run needs from the threads. */
export interface RunChats {
  create(projectId: string, scope: ChatScope, workspace?: ChatWorkspace): Promise<{ id: string; projectId: string }>;
  send(id: string, input: ProjectChatSend): Promise<void>;
  get(id: string): Promise<ProjectChat>;
  /** Whether the thread is still at work, waiting on the user included. */
  busy(id: string): Promise<boolean>;
}

/** What a run needs from the projects. */
export interface RunProjects {
  /** Whether it's still a project with its folder on this computer. */
  has(id: string): boolean;
  name(id: string): string | undefined;
  /** A Scratchpad chat's own project. */
  scratch(): Promise<{ id: string }>;
}

const SUMMARY_CHARS = 160;

/** The answer's first line of prose, for the run's row. */
export function summaryOf(body: string) {
  const line =
    body
      .split("\n")
      .map((l) => l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").trim())
      .find(Boolean) ?? "";
  return line.length > SUMMARY_CHARS ? `${sliceWhole(line, 0, SUMMARY_CHARS)}…` : line;
}

/** What the answer to the run's message used, as its agent reported. */
export function tokensOf(answer: ChatMessage | undefined) {
  const context = answer?.context;
  if (!context) return undefined;
  return Math.max(context.totalTokens ?? 0, context.usedTokens);
}

/** The answer to `messageId` in the main conversation, once there is one. */
export function answerTo(chat: ProjectChat, messageId: string) {
  const at = chat.messages.findIndex((m) => m.id === messageId);
  if (at < 0) return undefined;
  return chat.messages.slice(at + 1).find((m) => m.role === "assistant" && !m.parentId);
}

/** How a run whose answer ended went; undefined while it's still going. */
export function ended(
  answer: ChatMessage | undefined,
  limitHit: boolean,
): Pick<ScheduleRun, "outcome" | "summary" | "tokens"> | undefined {
  if (!answer || answer.status === "streaming") return undefined;
  const tokens = tokensOf(answer);
  const used = tokens ? { tokens } : {};
  if (answer.status === "complete")
    return { outcome: "done", summary: summaryOf(answer.body) || "Finished", ...used };
  if (answer.status === "cancelled")
    return {
      outcome: "stopped",
      summary: limitHit ? "Stopped at its token limit" : "Stopped",
      ...used,
    };
  return { outcome: "failed", summary: answer.error ?? "It failed.", ...used };
}

/** A thread for the run: in its own worktree when asked and the project is a Git repository. */
async function newThread(schedule: Schedule, scratch: boolean, chats: RunChats, projects: RunProjects) {
  const scope = { kind: "project" } as const;
  if (scratch) return chats.create((await projects.scratch()).id, scope, "checkout");
  if (schedule.workspace === "checkout") return chats.create(schedule.projectId, scope, "checkout");
  try {
    return await chats.create(schedule.projectId, scope, "worktree");
  } catch {
    return chats.create(schedule.projectId, scope, "checkout");
  }
}

/**
 * Starts a run: the thread the last run used when the schedule keeps one,
 * otherwise a new one, then the prompt as Relay's message there.
 */
export async function startRun(
  schedule: Schedule,
  test: boolean,
  chats: RunChats,
  projects: RunProjects,
): Promise<Pick<ScheduleRun, "chatId" | "projectId" | "messageId">> {
  const scratch = schedule.projectId === SCRATCHPAD_SCHEDULE;
  if (!scratch && !projects.has(schedule.projectId))
    throw new Error("Its project isn't in Relay any more.");
  // A test starts its own thread, out of the way of the one the runs keep.
  const carried =
    !test && !schedule.freshChat && schedule.lastChatId
      ? await chats.get(schedule.lastChatId).then(
          (chat) => (chat.archivedAt ? undefined : { id: chat.id, projectId: chat.projectId }),
          () => undefined,
        )
      : undefined;
  const thread = carried ?? (await newThread(schedule, scratch, chats, projects));
  const fitted = fitModel(schedule.agent, { choice: schedule.choice });
  const input = projectChatSendSchema.parse({
    id: randomUUID(),
    body: schedule.prompt,
    choice: fitted.choice,
    ...(fitted.contextWindow ? { contextWindow: fitted.contextWindow } : {}),
    provider: schedule.agent,
    to: schedule.agent,
    runtimeMode: schedule.runtimeMode,
    interactionMode: "default",
    scheduled: {
      id: schedule.id,
      name: schedule.name,
      ...(test ? { test: true as const } : {}),
    },
  } satisfies ProjectChatSend);
  await chats.send(thread.id, input);
  return { chatId: thread.id, projectId: thread.projectId, messageId: input.id };
}
