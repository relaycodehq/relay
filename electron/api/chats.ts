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
  linkedFoldersSchema,
  projectChatSendSchema,
  resumeSettingsSchema,
} from "../../shared/projects";
import { idSchema } from "../../shared/validation";
import { noteIdSchema, noteTextSchema } from "../../shared/thread-notes";
import { terminalSessionPickSchema } from "../../shared/terminal-sessions";
import { watchCloses } from "../../shared/watch";
import { workingPathSchema } from "../../shared/working-tree";
import { rememberSentModel } from "../agents/new-thread-models";
import { checkNewLinks } from "../projects/folder-inspect";
import { nameReviewSetup } from "../deep-review/review-setup-names";
import { takes, type ApiContext, type Handlers } from "./context";

/** A missing optional argument reaches the handler as undefined from the page and as null over the phone's JSON. */
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);
const agentIdSchema = z.string().min(1).max(200);
const imagePathSchema = z.string().min(1).max(500);
const branchSchema = z.string().trim().min(1).max(250);
const messageIdSchema = z.string().min(1).max(200);

/** Project threads: their turns, agents, worktrees, sharing, and deep reviews. */
export function chatHandlers(ctx: ApiContext) {
  const { store, projectChats, pullMerges, clientFor } = ctx;
  return {
    projectChats: takes([idSchema], (id) => ctx.listChats(id)),
    createProjectChat: takes(
      [
        idSchema,
        chatScopeSchema,
        optional(chatWorkspaceSchema),
        optional(branchSchema),
        optional(linkedFoldersSchema),
      ],
      async (id, scope, workspace, branch, links) => {
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
    threadNotes: takes([idSchema], (id) => projectChats.notes.list(id)),
    keepThreadNote: takes(
      [idSchema, noteTextSchema, optional(messageIdSchema)],
      (id, text, from) => projectChats.notes.add(id, { text, from }),
    ),
    tickThreadNote: takes(
      [idSchema, noteIdSchema, z.number().int().min(1), z.boolean()],
      (id, note, item, done) => projectChats.notes.tick(id, note, item, done),
    ),
    removeThreadNote: takes([idSchema, noteIdSchema], (id, note) =>
      projectChats.notes.remove(id, note),
    ),
    markProjectChatSeen: takes(
      [idSchema, z.number().int().min(0)],
      (id, seenAt) => projectChats.markSeen(id, seenAt),
    ),
    sendProjectChat: takes(
      [idSchema, projectChatSendSchema],
      async (id, send) => {
        const sent = await projectChats.sendYours(id, send);
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
    selectAgentWorktree: takes(
      [idSchema, z.string().min(1).max(4096).nullable()],
      (chatId, path) => projectChats.selectAgentWorktree(chatId, path),
    ),
    startDeepReview: takes(
      [idSchema, deepReviewStartSchema],
      async (id, config) => {
        // The forge knows which branch a pull request merges into.
        const pull =
          config.target.kind === "pr"
            ? await (await clientFor(config.target.ref)).pull(config.target.ref)
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
