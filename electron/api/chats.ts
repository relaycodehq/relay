import { openPath } from "./open-path";
import { existsSync } from "node:fs";
import { shell } from "electron";
import { z } from "zod";
import { agentResponseSchema } from "../../shared/agent-modes";
import {
  deepReviewStartSchema,
  reviewSetupSchema,
} from "../../shared/deep-review";
import {
  chatScopeSchema,
  chatTriageSchema,
  chatWorkspaceSchema,
  knownMessagesSchema,
  projectChatSendSchema,
  resumeSettingsSchema,
} from "../../shared/projects";
import { idSchema, presenceSchema } from "../../shared/rooms";
import { watchCloses } from "../../shared/watch";
import { workingPathSchema } from "../../shared/working-tree";
import { rememberSentModel } from "../agents/new-thread-models";
import { nameReviewSetup } from "../deep-review/review-setup-names";
import { takes, type ApiContext, type Handlers } from "./context";

/** A missing optional argument reaches the handler as undefined from the page and as null over the phone's JSON. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);
const agentIdSchema = z.string().min(1).max(200);
const imagePathSchema = z.string().min(1).max(500);
const branchSchema = z.string().trim().min(1).max(250);

/** Project threads: their turns, agents, worktrees, sharing, and deep reviews. */
export function chatHandlers(ctx: ApiContext) {
  const { store, projectChats, pullMerges, requireClient } = ctx;
  return {
    projectChats: takes([idSchema], (id) => ctx.listChats(id)),
    createProjectChat: takes(
      [
        idSchema,
        chatScopeSchema,
        optional(chatWorkspaceSchema),
        optional(branchSchema),
      ],
      (id, scope, workspace, branch) =>
        projectChats.create(id, scope, workspace, undefined, branch),
    ),
    worktreeBranch: takes(
      [idSchema, z.string(), optional(branchSchema)],
      (projectId, prompt, branch) =>
        projectChats.worktreeBranch(projectId, prompt, branch),
    ),
    projectChat: takes(
      [idSchema, optional(knownMessagesSchema)],
      async (id, known) => {
        const chat = known
          ? await projectChats.changes(id, known)
          : await projectChats.get(id);
        projectChats.ensureTitle(id);
        return chat;
      },
    ),
    triageProjectChat: takes([idSchema, chatTriageSchema], (id, triage) =>
      projectChats.triage(id, triage),
    ),
    forkProjectChat: takes([idSchema, optional(idSchema)], (id, messageId) =>
      projectChats.fork(id, messageId),
    ),
    regenerateProjectChatTitle: takes([idSchema], (id) =>
      projectChats.regenerateTitle(id),
    ),
    renameProjectChat: takes([idSchema, z.string()], (id, title) =>
      projectChats.rename(id, title),
    ),
    detachProjectChat: takes([idSchema], (id) => projectChats.detach(id)),
    markProjectChatSeen: takes(
      [idSchema, z.number().int().min(0)],
      (id, seenAt) => projectChats.markSeen(id, seenAt),
    ),
    sendProjectChat: takes(
      [idSchema, projectChatSendSchema],
      async (id, send) => {
        const sent = await projectChats.send(id, send);
        await rememberSentModel(store, send);
        return sent;
      },
    ),
    resumeProjectChat: takes(
      [idSchema, optional(resumeSettingsSchema)],
      (id, settings) => projectChats.resume(id, settings),
    ),
    compactProjectChat: takes(
      [idSchema, optional(idSchema), optional(z.string().trim().max(4000))],
      (id, parentId, instructions) =>
        projectChats.compact(id, parentId, instructions || undefined),
    ),
    reloadProjectChatSession: takes([idSchema], (id) =>
      projectChats.reloadSessions(id),
    ),
    rerunWorktreeSetup: takes([idSchema, idSchema], (id, messageId) =>
      projectChats.rerunWorktreeSetup(id, messageId),
    ),
    projectChatQueueAction: takes(
      [
        idSchema,
        z.enum(["remove", "steer", "move"]),
        idSchema,
        optional(z.number().int().min(0).max(20)),
      ],
      (id, action, messageId, index) =>
        projectChats.queueAction(id, action, messageId, index),
    ),
    respondProjectChat: takes(
      [idSchema, idSchema, agentResponseSchema],
      (id, requestId, response) =>
        projectChats.respond(id, requestId, response),
    ),
    cancelProjectChat: takes([idSchema], (id) => projectChats.cancel(id)),
    resolveStoppedWork: takes(
      [idSchema, z.enum(["resume", "dismiss"])],
      (id, action) => projectChats.resolveStoppedWork(id, action),
    ),
    setLimitResume: takes([idSchema, z.boolean()], (id, on) =>
      projectChats.setLimitResume(id, on),
    ),
    stopProjectChatPending: takes([idSchema, agentIdSchema], (id, pendingId) =>
      projectChats.stopPending(id, pendingId),
    ),
    projectChatAgents: takes([idSchema], (id) => projectChats.agents(id)),
    projectChatContext: takes([idSchema, optional(idSchema)], (id, parentId) =>
      projectChats.contextReport(id, parentId),
    ),
    projectChatAgent: takes([idSchema, agentIdSchema], (id, agentId) =>
      projectChats.agentRun(id, agentId),
    ),
    stopProjectChatAgent: takes([idSchema, agentIdSchema], (id, agentId) =>
      projectChats.stopAgent(id, agentId),
    ),
    projectChatImage: takes([idSchema, idSchema], (id, imageId) =>
      projectChats.image(id, imageId),
    ),
    projectChatQueuedImages: takes([idSchema, idSchema], (id, messageId) =>
      projectChats.queuedImages(id, messageId),
    ),
    projectChatReadImage: takes(
      [idSchema, idSchema, imagePathSchema],
      (id, messageId, path) => projectChats.readImage(id, messageId, path),
    ),
    revealProjectChatReadImage: takes(
      [idSchema, idSchema, imagePathSchema],
      async (id, messageId, path) => {
        shell.showItemInFolder(
          await projectChats.turnImagePath(id, messageId, path),
        );
      },
    ),
    projectTurnDiff: takes(
      [idSchema, idSchema, workingPathSchema],
      (chatId, messageId, path) =>
        projectChats.turnDiff(chatId, messageId, path),
    ),
    revealProjectTurnFile: takes(
      [idSchema, idSchema.nullable(), workingPathSchema],
      async (chatId, messageId, path) => {
        const file = await projectChats.turnFilePath(chatId, messageId, path);
        if (!existsSync(file)) throw new Error("That file is gone from disk.");
        shell.showItemInFolder(file);
      },
    ),
    rewindProjectTurn: takes(
      [
        idSchema,
        idSchema,
        z.array(workingPathSchema).max(1000).nullable(),
        z.enum(["revert", "redo"]),
        z.boolean(),
      ],
      (chatId, messageId, paths, mode, force) =>
        projectChats.rewindTurn(chatId, messageId, paths, mode, force),
    ),
    projectWorktree: takes([idSchema], async (chatId) => {
      const status = await projectChats.worktreeStatus(chatId);
      if (
        status.pr &&
        !status.landed &&
        (await pullMerges.check(chatId, status.pr.number))
      )
        return projectChats.worktreeStatus(chatId);
      return status;
    }),
    projectWorktreeDiff: takes([idSchema, workingPathSchema], (chatId, path) =>
      projectChats.worktreeDiff(chatId, path),
    ),
    removeProjectWorktree: takes([idSchema], (chatId) =>
      projectChats.removeWorktree(chatId),
    ),
    projectWorktreeMove: takes([idSchema], (chatId) =>
      projectChats.worktreeMovePreview(chatId),
    ),
    moveProjectChatToWorktree: takes([idSchema], (chatId) =>
      projectChats.moveToWorktree(chatId),
    ),
    revealProjectWorktree: takes([idSchema], (chatId) =>
      openPath(projectChats.worktreePath(chatId)),
    ),
    revealAgentWorktree: takes(
      [idSchema, z.string().max(4096)],
      (chatId, path) => openPath(projectChats.agentWorktreePath(chatId, path)),
    ),
    projectChatPresence: takes(
      [idSchema, presenceSchema.omit({ head: true }).nullable()],
      (id, value) => projectChats.presence(id, value),
    ),
    projectChatShareInfo: takes([idSchema], (id) => projectChats.shareInfo(id)),
    shareProjectChat: takes([idSchema], (id) => projectChats.share(id)),
    syncProjectChat: takes(
      [idSchema, optional(knownMessagesSchema)],
      (id, known) =>
        known ? projectChats.syncChanges(id, known) : projectChats.sync(id),
    ),
    projectChatInvite: takes([idSchema], (id) => projectChats.invite(id)),
    sharedProjectChats: takes([idSchema], (id) => projectChats.sharedList(id)),
    openSharedProjectChat: takes([idSchema, idSchema], (projectId, roomId) =>
      projectChats.openShared(projectId, roomId),
    ),
    joinProjectConversation: takes(
      [idSchema, z.string().max(16384)],
      (projectId, url) => projectChats.join(projectId, url),
    ),
    startDeepReview: takes(
      [idSchema, deepReviewStartSchema],
      async (id, config) => {
        // The forge knows which branch a pull request merges into.
        const pull =
          config.target.kind === "pr"
            ? await requireClient().pull(config.target.ref)
            : undefined;
        return projectChats.startDeepReview(
          id,
          config,
          pull && {
            number: pull.number,
            title: pull.title,
            base: pull.base.ref,
          },
        );
      },
    ),
    nameReviewSetup: takes([reviewSetupSchema], (setup) =>
      nameReviewSetup(setup, store.aiSettings(), AbortSignal.timeout(60_000)),
    ),
    resumeDeepReview: takes([idSchema], (id) =>
      projectChats.resumeDeepReview(id),
    ),
    resumeUltraplan: takes([idSchema, idSchema], (id, request) =>
      projectChats.resumeUltraplan(id, request),
    ),
    setDeepReviewFinding: takes(
      [idSchema, z.string().regex(/^F\d{1,3}$/), z.enum(["open", "dismissed"])],
      (id, findingId, status) =>
        projectChats.setDeepReviewFinding(id, findingId, status),
    ),
    closeWatchNote: takes(
      [idSchema, idSchema, idSchema, z.enum(watchCloses), z.boolean()],
      (id, messageId, noteId, how, read) =>
        projectChats.closeWatchNote(id, messageId, noteId, how, read),
    ),
    watchSpend: () => projectChats.watchSpend(7),
    watchReview: () => projectChats.watchReview(7),
    judgeWatchNotes: () => projectChats.judgeWatchNotes(7),
  } satisfies Handlers;
}
