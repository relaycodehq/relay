import { openPath } from "./open-path";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { shell } from "electron";
import { z } from "zod";
import { agentResponseSchema } from "../../shared/agent-modes";
import {
  chatScopeSchema,
  chatTriageSchema,
  chatWorkspaceSchema,
  knownMessagesSchema,
  linkedFoldersSchema,
  projectChatSendSchema,
  resumeSettingsSchema,
  worktreeStartSchema,
} from "../../shared/projects";
import { idSchema } from "../../shared/validation";
import { terminalSessionPickSchema } from "../../shared/terminal-sessions";
import { watchCloses } from "../../shared/watch";
import { workingPathSchema } from "../../shared/working-tree";
import { rememberSent } from "../agents/new-thread-models";
import { checkNewLinks } from "../projects/folder-inspect";
import { mediaUrl } from "../media";
import {
  messageIdSchema,
  optional,
  takes,
  type ApiContext,
  type Handlers,
} from "./context";

const agentIdSchema = z.string().min(1).max(200);
const imagePathSchema = z.string().min(1).max(500);
const branchSchema = z.string().trim().min(1).max(250);

/** Project threads: their turns, agents, worktrees and sharing. */
export function chatHandlers(ctx: ApiContext) {
  const { store, projectChats, pullMerges } = ctx;
  return {
    projectChats: takes([idSchema], (id) => ctx.listChats(id)),
    createProjectChat: takes(
      [
        idSchema,
        chatScopeSchema,
        optional(chatWorkspaceSchema),
        optional(branchSchema),
        optional(linkedFoldersSchema),
        optional(worktreeStartSchema),
      ],
      async (id, scope, workspace, branch, links, start) => {
        links = await checkNewLinks(
          links,
          undefined,
          ctx.projects.get(id).path,
        );
        return projectChats.create(
          id,
          scope,
          workspace,
          undefined,
          branch,
          links,
          start,
        );
      },
    ),
    setProjectChatLinks: takes(
      [idSchema, linkedFoldersSchema],
      async (id, links) => {
        const chat = await projectChats.get(id);
        links = await checkNewLinks(
          links,
          chat.links,
          ctx.projects.get(chat.projectId).path,
        );
        return projectChats.setLinks(id, links);
      },
    ),
    promoteProjectChatLink: takes(
      [idSchema, z.string().min(1).max(4096)],
      async (id, path) => {
        const result = await projectChats.promoteLink(id, path);
        projectChats.summariesChanged(result.project.id);
        return result;
      },
    ),
    worktreeBranch: takes([idSchema, branchSchema], (projectId, branch) =>
      projectChats.worktrees.branch(projectId, branch),
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
    terminalSessions: takes([idSchema], (id) =>
      projectChats.terminalSessions(id),
    ),
    continueTerminalSession: takes(
      [
        idSchema,
        terminalSessionPickSchema,
        optional(chatWorkspaceSchema),
        optional(branchSchema),
        optional(linkedFoldersSchema),
      ],
      async (id, pick, workspace, branch, links) => {
        links = await checkNewLinks(
          links,
          undefined,
          ctx.projects.get(id).path,
        );
        return projectChats.continueTerminalSession(
          id,
          pick,
          workspace,
          branch,
          links,
        );
      },
    ),
    regenerateProjectChatTitle: takes([idSchema], (id) =>
      projectChats.regenerateTitle(id),
    ),
    renameProjectChat: takes([idSchema, z.string()], (id, title) =>
      projectChats.rename(id, title),
    ),
    detachProjectChat: takes([idSchema], (id) => projectChats.detach(id)),
    stopProjectChatDriving: takes([idSchema], (id) =>
      projectChats.allowDriving(id, false),
    ),
    markProjectChatSeen: takes(
      [idSchema, z.number().int().min(0)],
      (id, seenAt) => projectChats.markSeen(id, seenAt),
    ),
    sendProjectChat: takes(
      [idSchema, projectChatSendSchema],
      async (id, send) => {
        const sent = await projectChats.sendYours(id, send);
        await rememberSent(store, send);
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
    answerProjectChatQuestion: takes(
      [idSchema, idSchema, agentIdSchema, agentResponseSchema],
      (id, messageId, itemId, response) =>
        projectChats.answerQuestion(id, messageId, itemId, response),
    ),
    setProjectChatQuestionDismissed: takes(
      [idSchema, idSchema, agentIdSchema, z.boolean()],
      (id, messageId, itemId, dismissed) =>
        projectChats.setQuestionDismissed(id, messageId, itemId, dismissed),
    ),
    cancelProjectChat: takes(
      [
        idSchema,
        optional(z.object({ steers: z.boolean().optional() }).strict()),
      ],
      (id, options) => projectChats.cancel(id, options ?? {}),
    ),
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
      projectChats.files.image(id, imageId),
    ),
    projectChatQueuedImages: takes([idSchema, idSchema], (id, messageId) =>
      projectChats.queuedImages(id, messageId),
    ),
    projectChatReadImage: takes(
      [idSchema, idSchema, imagePathSchema],
      (id, messageId, path) =>
        projectChats.files.readImage(id, messageId, path),
    ),
    projectChatVideo: takes(
      [idSchema, idSchema, imagePathSchema],
      async (id, messageId, path) => {
        const full = await projectChats.files.turnVideoPath(
          id,
          messageId,
          path,
        );
        return mediaUrl(full, dirname(full));
      },
    ),
    projectChatPreviewShot: takes(
      [idSchema, messageIdSchema],
      (id, messageId) => projectChats.files.previewShot(id, messageId),
    ),
    revealProjectChatReadImage: takes(
      [idSchema, idSchema, imagePathSchema],
      async (id, messageId, path) => {
        shell.showItemInFolder(
          await projectChats.files.revealImagePath(id, messageId, path),
        );
      },
    ),
    projectTurnDiff: takes(
      [idSchema, idSchema, workingPathSchema],
      (chatId, messageId, path) =>
        projectChats.files.diff(chatId, messageId, path),
    ),
    revealProjectTurnFile: takes(
      [idSchema, idSchema.nullable(), workingPathSchema],
      async (chatId, messageId, path) => {
        const file = await projectChats.files.path(chatId, messageId, path);
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
      projectChats.worktrees.diff(chatId, path),
    ),
    removeProjectWorktree: takes([idSchema], (chatId) =>
      projectChats.worktrees.remove(chatId),
    ),
    projectWorktreeMove: takes([idSchema], (chatId) =>
      projectChats.worktrees.movePreview(chatId),
    ),
    moveProjectChatToWorktree: takes([idSchema], (chatId) =>
      projectChats.worktrees.move(chatId),
    ),
    revealProjectWorktree: takes([idSchema], (chatId) =>
      openPath(projectChats.worktrees.path(chatId)),
    ),
    revealAgentWorktree: takes(
      [idSchema, z.string().max(4096)],
      (chatId, path) =>
        openPath(projectChats.agentWorkspaces.path(chatId, path)),
    ),
    selectAgentWorktree: takes(
      [idSchema, z.string().min(1).max(4096).nullable()],
      (chatId, path) => projectChats.agentWorkspaces.select(chatId, path),
    ),
    agentWorktreeRecreatable: takes([idSchema], (chatId) =>
      projectChats.agentWorkspaces.recreatable(chatId),
    ),
    recreateAgentWorktree: takes([idSchema], (chatId) =>
      projectChats.agentWorkspaces.recreate(chatId),
    ),
    closeWatchNote: takes(
      [idSchema, idSchema, idSchema, z.enum(watchCloses), z.boolean()],
      (id, messageId, noteId, how, read) =>
        projectChats.closeWatchNote(id, messageId, noteId, how, read),
    ),
    watchSpend: () => projectChats.watchSpend(7),
    predictionSpend: () => projectChats.predictionSpend(7),
    seePrediction: takes(
      [idSchema, idSchema, z.enum(["shown", "dismissed"])],
      (id, messageId, how) => projectChats.seePrediction(id, messageId, how),
    ),
    watchReview: () => projectChats.watchReview(7),
    judgeWatchNotes: () => projectChats.judgeWatchNotes(7),
  } satisfies Handlers;
}
