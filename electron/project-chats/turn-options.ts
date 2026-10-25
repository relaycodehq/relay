// What the agent runs a turn with: where it works and on what, what it may
// do, and where everything it reports lands.
import type {
  AgentActivity,
  ProjectChat,
  ProjectChatSend,
} from "../../shared/projects";
import { linksInstructions, threadLinks } from "../../shared/projects";
import { goalChanged } from "../../shared/goal";
import type { AgentOptions } from "../agents/types";
import { projectTasks } from "../terminal/tasks";
import { relayToolsFor, startedNote } from "../relay-mcp";
import {
  threadWorktreePaths,
  turnWorkspace,
  watchAgentWorktrees,
} from "./agent-worktrees";
import { agentJob } from "./chat-turn";
import type { ChatCore } from "./core";
import { sessionFor } from "./sessions";
import { predictFor, watchFor } from "./turn-check";
import type { TurnSnapshot } from "./turn-snapshot";
import type { TurnDeps, TurnState } from "./turn-state";

/** The options a turn runs with; its session is always there, as a retry rewrites it. */
export type TurnOptions = AgentOptions & {
  session: NonNullable<AgentOptions["session"]>;
};

/** What the agent runs the turn with, and how what it does lands in the answer. */
export async function turnOptions(
  deps: TurnDeps,
  t: TurnState,
  prompt: string,
  sessionId: string | undefined,
  snapshot: TurnSnapshot,
): Promise<TurnOptions> {
  const { core, host } = deps;
  const { chat, root, input, turn, abort } = t;
  // Each agent session hears about running processes on its own.
  const noteKey = JSON.stringify([t.sessionKey, t.provider]);
  if (!sessionId) projectTasks.forgetNote(noteKey);
  const env = await host.env(chat);
  const links = await linksOf(core, chat, root);
  const access = accessOf(core, t);
  const attached = [
    ...((turn.kind === "reply" && turn.carried) || []),
    ...(chat.messages.find((m) => m.id === input.id)?.images ?? []),
  ];
  const watch = watchFor(core, t);
  const predict = predictFor(core, t);
  return {
    job: agentJob(turn, chat),
    // A reviewer's work counts toward the thread it serves.
    usage: {
      chat: chat.reviewer?.parent ?? chat.id,
      project: chat.projectId,
    },
    cwd: root,
    ...(links.length ? { links } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    prompt,
    ...(turn.kind === "reply" && turn.request ? { request: turn.request } : {}),
    context: async () =>
      [
        await projectTasks.note(
          root,
          noteKey,
          chat.id,
          chat.worktree ? await core.projects.root(chat.projectId) : undefined,
        ),
        linksInstructions(links),
        startedNoteFor(core, chat, input, access.canMessageLead),
      ]
        .filter(Boolean)
        .join("\n\n") || undefined,
    choice: input.choice,
    account: t.account,
    signal: abort.signal,
    images: attached.map((image) => ({
      path: core.storage.imagePath(chat.id, image),
      mimeType: image.mimeType,
    })),
    ...access.options,
    ...answerCallbacks(deps, t),
    ...goalOptions(core, t),
    ...(await workCallbacks(core, t, snapshot)),
    ...(watch ? { watch } : {}),
    ...(predict ? { predict } : {}),
    session: {
      key: t.sessionKey,
      id: sessionId,
      fork: t.fork?.point,
      onPoint: (at: string) => {
        t.point = at;
      },
      onId: async (id: string) => {
        sessionFor(chat, t.provider, t.replyTo).thread = id;
        await core.storage.save(chat);
      },
      onUnprompted: () => host.unprompted(chat, root, t.provider, t.replyTo),
    },
  };
}

/** What the turn may do: its mode, and which of Relay's tools it gets. */
function accessOf(core: ChatCore, { chat, input, rules }: TurnState) {
  const relayTools = relayToolsFor(
    chat.id,
    !!chat.startedBy,
    core.store.get().renderMode,
    !!chat.importFrom,
  );
  const readOnly =
    !!chat.reviewer || !!rules.side || input.runtimeMode === "read-only";
  const options: Pick<
    AgentOptions,
    "runtimeMode" | "interactionMode" | "readOnly" | "relayTools" | "onRequest"
  > = {
    runtimeMode:
      input.runtimeMode === "read-only"
        ? "approval-required"
        : input.runtimeMode,
    interactionMode: input.interactionMode,
    // Read only runs as a reviewer does: no writes, MCP servers or Relay's tools.
    ...(readOnly ? { readOnly } : {}),
    // A started thread only gets the reading ones: no threads of threads.
    ...(relayTools && !readOnly ? { relayTools } : {}),
    // The thread's running answer owns its requests; a side turn asks none.
    onRequest: rules.side ? undefined : core.active.get(chat.id)?.requests.ask,
  };
  return { options, canMessageLead: !!relayTools && !readOnly };
}

/** Where what the agent writes and reports lands in the answer. */
function answerCallbacks(
  { core, titles }: TurnDeps,
  { chat, abort, answer, rules, replyTo }: TurnState,
): Pick<
  AgentOptions,
  | "onControl"
  | "onSteered"
  | "onSteerUnread"
  | "onContext"
  | "onCost"
  | "onUsage"
  | "onText"
  | "onPlan"
  | "onTitle"
  | "onCommentary"
  | "onQuestions"
> {
  return {
    // Steering and retuning reach the turn while it's still the thread's running one.
    onControl: (control) => {
      const active = core.active.get(chat.id);
      if (active?.abort !== abort) return;
      active.steer = control.steer;
      active.goal = control.goal;
      active.retune = control.retune;
    },
    onSteered: (id) => answer.continueBelow(id),
    onSteerUnread: (id, error) => answer.unreadSteer(id, error),
    onContext: (usage) => answer.context(usage),
    onCost: (usd) => answer.cost(usd),
    onUsage: (usage) => {
      if (usage.streamed && !usage.subagent) answer.streamed(usage.streamed);
    },
    onText: (body) => answer.text(body),
    onPlan: (body) => answer.plan(body),
    onTitle: (title) => {
      if (!replyTo) titles.heard(chat, answer.message, title);
    },
    onCommentary: (id, text) => answer.commentary(id, text),
    onQuestions: rules.side
      ? undefined
      : (id, questions) => answer.questions(id, questions),
  };
}

/** The thread's native `/goal`, kept on the main conversation. */
function goalOptions(
  core: ChatCore,
  { chat, provider, replyTo, rules }: TurnState,
): Pick<AgentOptions, "goal" | "onGoal"> {
  let savedAt = 0;
  return {
    ...(!replyTo && chat.goal?.provider === provider
      ? { goal: chat.goal }
      : {}),
    onGoal: (goal) => {
      // A goal belongs to the main conversation; side ones run their own.
      if (replyTo || rules.side) return;
      const before = chat.goal;
      if (goal) chat.goal = goal;
      else delete chat.goal;
      // Token counts tick with every tool call; the thread file holds every message.
      const now = Date.now();
      if (!goalChanged(before, goal) && now - savedAt < 15_000) return;
      savedAt = now;
      void core.storage
        .save(chat)
        .catch((e) => console.warn("Could not save the goal:", e));
    },
  };
}

/**
 * What the agent's work feeds besides the answer: the project's running
 * tasks, the turn's snapshot of changed files, and worktrees it makes.
 */
async function workCallbacks(
  core: ChatCore,
  { chat, root, provider, answer }: TurnState,
  snapshot: TurnSnapshot,
): Promise<Pick<AgentOptions, "onActivity" | "onEdit">> {
  const workspace = turnWorkspace(chat, provider);
  const watchWorktrees = watchAgentWorktrees(
    await core.projects.root(chat.projectId),
    () => threadWorktreePaths(core.store.get().chats),
    () => chat.agentWorktrees ?? [],
    async (worktrees) => {
      workspace(worktrees);
      await core.storage.save(chat);
    },
  );
  return {
    onActivity: (activity: AgentActivity) => {
      if (activity.kind === "command" && activity.status === "running")
        projectTasks.record(root, chat.id, activity.label);
      snapshot.activity(activity);
      watchWorktrees(activity);
      answer.activity(activity);
    },
    onEdit: (paths) => snapshot.edits(paths),
  };
}

/** What the thread reaches beyond its folder; a reviewer reaches what its thread does. */
async function linksOf(core: ChatCore, chat: ProjectChat, root: string) {
  const parent = chat.reviewer?.parent;
  const own = parent
    ? await core.storage.load(parent).then(
        (c) => c.links,
        () => undefined,
      )
    : chat.links;
  const project = core.projects.get(chat.projectId).settings?.links;
  return threadLinks(project, own, root).map(({ from, ...link }) => link);
}

/** Who started the thread, for a started thread's agent; a reviewer reports to its council instead. */
function startedNoteFor(
  core: ChatCore,
  chat: ProjectChat,
  input: ProjectChatSend,
  canMessage: boolean,
) {
  const by = chat.startedBy;
  if (!by || chat.reviewer) return undefined;
  const lead = (core.store.get().chats ?? []).find((c) => c.id === by.chatId);
  if (!lead) return undefined;
  return startedNote({
    lead: { id: lead.id, title: lead.title, agent: by.agent },
    fromLead: input.fromThread?.id === lead.id,
    canMessage,
  });
}
