import { openPath } from "./open-path";
import { existsSync } from "node:fs";
import { shell } from "electron";
import { z } from "zod";
import { agentResponseSchema } from "../../shared/agent-modes";
import { deepReviewStartSchema } from "../../shared/deep-review";
import {
  chatScopeSchema,
  chatTriageSchema,
  chatWorkspaceSchema,
  knownMessagesSchema,
  projectChatSendSchema,
  resumeSettingsSchema,
} from "../../shared/projects";
import { idSchema, presenceSchema } from "../../shared/rooms";
import { workingPathSchema } from "../../shared/working-tree";
import type { ApiContext, Handlers } from "./context";

/** Project threads: their turns, agents, worktrees, sharing, and deep reviews. */
export function chatHandlers(ctx: ApiContext) {
  const { store, projects, projectChats, login, requireClient } = ctx;
  /** Whether a worktree thread's PR was merged on Gitea; asked at most once a minute. */
  const pullChecks = new Map<string, { at: number; merged: boolean }>();
  async function pullMerged(chatId: string, number: number) {
    const seen = pullChecks.get(chatId);
    if (seen && Date.now() - seen.at < 60000) return seen.merged;
    const projectId = store
      .get()
      .chats?.find((c) => c.id === chatId)?.projectId;
    if (!projectId || !login.client) return false;
    const gitea = login.client;
    const merged = await projects
      .linked(projectId, gitea)
      .then((repo) => gitea.pull({ ...repo, number }))
      .then(
        (pull) => !!pull.merged,
        () => false,
      );
    pullChecks.set(chatId, { at: Date.now(), merged });
    return merged;
  }
  return {
    projectChats: (args) => projectChats.list(idSchema.parse(args[0])),
    createProjectChat: (args) =>
      projectChats.create(
        idSchema.parse(args[0]),
        chatScopeSchema.parse(args[1]),
        chatWorkspaceSchema.optional().parse(args[2] ?? undefined),
      ),
    projectChat: async (args) => {
      const id = idSchema.parse(args[0]);
      const chat =
        args[1] == null
          ? await projectChats.get(id)
          : await projectChats.changes(id, knownMessagesSchema.parse(args[1]));
      projectChats.ensureTitle(id);
      return chat;
    },
    triageProjectChat: (args) =>
      projectChats.triage(
        idSchema.parse(args[0]),
        chatTriageSchema.parse(args[1]),
      ),
    forkProjectChat: (args) =>
      projectChats.fork(idSchema.parse(args[0]), idSchema.parse(args[1])),
    renameProjectChat: (args) =>
      projectChats.rename(idSchema.parse(args[0]), z.string().parse(args[1])),
    sendProjectChat: (args) =>
      projectChats.send(
        idSchema.parse(args[0]),
        projectChatSendSchema.parse(args[1]),
      ),
    resumeProjectChat: (args) =>
      projectChats.resume(
        idSchema.parse(args[0]),
        resumeSettingsSchema.optional().parse(args[1] ?? undefined),
      ),
    compactProjectChat: (args) =>
      projectChats.compact(
        idSchema.parse(args[0]),
        args[1] == null ? undefined : idSchema.parse(args[1]),
        z.string().trim().max(4000).optional().parse(args[2]) || undefined,
      ),
    projectChatQueueAction: (args) =>
      projectChats.queueAction(
        idSchema.parse(args[0]),
        z.enum(["remove", "steer", "move"]).parse(args[1]),
        idSchema.parse(args[2]),
        z.number().int().min(0).max(20).optional().parse(args[3]),
      ),
    respondProjectChat: (args) =>
      projectChats.respond(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        agentResponseSchema.parse(args[2]),
      ),
    cancelProjectChat: (args) => projectChats.cancel(idSchema.parse(args[0])),
    resolveStoppedWork: (args) =>
      projectChats.resolveStoppedWork(
        idSchema.parse(args[0]),
        z.enum(["resume", "dismiss"]).parse(args[1]),
      ),
    stopProjectChatPending: (args) =>
      projectChats.stopPending(
        idSchema.parse(args[0]),
        z.string().min(1).max(200).parse(args[1]),
      ),
    projectChatAgents: (args) => projectChats.agents(idSchema.parse(args[0])),
    projectChatAgent: (args) =>
      projectChats.agentRun(
        idSchema.parse(args[0]),
        z.string().min(1).max(200).parse(args[1]),
      ),
    stopProjectChatAgent: (args) =>
      projectChats.stopAgent(
        idSchema.parse(args[0]),
        z.string().min(1).max(200).parse(args[1]),
      ),
    projectChatImage: (args) =>
      projectChats.image(idSchema.parse(args[0]), idSchema.parse(args[1])),
    projectChatReadImage: (args) =>
      projectChats.readImage(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        z.string().min(1).max(500).parse(args[2]),
      ),
    revealProjectChatReadImage: async (args) => {
      shell.showItemInFolder(
        await projectChats.turnImagePath(
          idSchema.parse(args[0]),
          idSchema.parse(args[1]),
          z.string().min(1).max(500).parse(args[2]),
        ),
      );
    },
    projectTurnDiff: (args) =>
      projectChats.turnDiff(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        workingPathSchema.parse(args[2]),
      ),
    revealProjectTurnFile: async (args) => {
      const file = await projectChats.turnFilePath(
        idSchema.parse(args[0]),
        idSchema.nullable().parse(args[1]),
        workingPathSchema.parse(args[2]),
      );
      if (!existsSync(file)) throw new Error("That file is gone from disk.");
      shell.showItemInFolder(file);
    },
    rewindProjectTurn: (args) =>
      projectChats.rewindTurn(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
        z.array(workingPathSchema).max(1000).nullable().parse(args[2]),
        z.enum(["revert", "redo"]).parse(args[3]),
        z.boolean().parse(args[4]),
      ),
    projectWorktree: async (args) => {
      const chatId = idSchema.parse(args[0]);
      const status = await projectChats.worktreeStatus(chatId);
      if (status.pr && !status.landed && login.client)
        if (await pullMerged(chatId, status.pr.number)) {
          await projectChats.pullMerged(chatId);
          return projectChats.worktreeStatus(chatId);
        }
      return status;
    },
    projectWorktreeDiff: (args) =>
      projectChats.worktreeDiff(
        idSchema.parse(args[0]),
        workingPathSchema.parse(args[1]),
      ),
    removeProjectWorktree: (args) =>
      projectChats.removeWorktree(idSchema.parse(args[0])),
    revealProjectWorktree: (args) =>
      openPath(projectChats.worktreePath(idSchema.parse(args[0]))),
    revealAgentWorktree: (args) =>
      openPath(
        projectChats.agentWorktreePath(
          idSchema.parse(args[0]),
          z.string().max(4096).parse(args[1]),
        ),
      ),
    projectChatPresence: (args) =>
      projectChats.presence(
        idSchema.parse(args[0]),
        presenceSchema.omit({ head: true }).nullable().parse(args[1]),
      ),
    projectChatShareInfo: (args) =>
      projectChats.shareInfo(idSchema.parse(args[0])),
    shareProjectChat: (args) => projectChats.share(idSchema.parse(args[0])),
    syncProjectChat: (args) => {
      const id = idSchema.parse(args[0]);
      return args[1] == null
        ? projectChats.sync(id)
        : projectChats.syncChanges(id, knownMessagesSchema.parse(args[1]));
    },
    projectChatInvite: (args) => projectChats.invite(idSchema.parse(args[0])),
    sharedProjectChats: (args) =>
      projectChats.sharedList(idSchema.parse(args[0])),
    openSharedProjectChat: (args) =>
      projectChats.openShared(idSchema.parse(args[0]), idSchema.parse(args[1])),
    joinProjectConversation: (args) =>
      projectChats.join(
        idSchema.parse(args[0]),
        z.string().max(16384).parse(args[1]),
      ),
    startDeepReview: async (args) => {
      const id = idSchema.parse(args[0]);
      const config = deepReviewStartSchema.parse(args[1]);
      // The forge knows which branch a pull request merges into.
      const pull =
        config.target.kind === "pr"
          ? await requireClient().pull(config.target.ref)
          : undefined;
      return projectChats.startDeepReview(
        id,
        config,
        pull && { number: pull.number, title: pull.title, base: pull.base.ref },
      );
    },
    resumeDeepReview: (args) =>
      projectChats.resumeDeepReview(idSchema.parse(args[0])),
    resumeUltraplan: (args) =>
      projectChats.resumeUltraplan(
        idSchema.parse(args[0]),
        idSchema.parse(args[1]),
      ),
    setDeepReviewFinding: (args) =>
      projectChats.setDeepReviewFinding(
        idSchema.parse(args[0]),
        z
          .string()
          .regex(/^F\d{1,3}$/)
          .parse(args[1]),
        z.enum(["open", "dismissed"]).parse(args[2]),
      ),
  } satisfies Handlers;
}
