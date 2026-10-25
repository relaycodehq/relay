// Which calls reach this computer, from a phone or from a paired computer,
// and which of them get the slow timeout.

import type { RemoteMethod } from "./remote";
import type { Api, ApiMethod } from "./types";

/**
 * Desktop calls a paired phone makes as they are, validated by the desktop's
 * own dispatch: threads and their notes, models, Git (stage, commit, push, pull, fetch,
 * branches), read-only files, history, background tasks, subagents and pull requests
 * (reading them, commenting and reviewing); only what the
 * phone app uses. Terminals, file saves, settings (bar the agent new threads
 * start on), sharing and anything that opens a desktop dialog are not on the
 * list and stay out of reach.
 */
export const phoneDesktopMethods = [
  "createProjectChat",
  "createScratch",
  "sendProjectChat",
  "cancelProjectChat",
  "respondProjectChat",
  "answerProjectChatQuestion",
  "setProjectChatQuestionDismissed",
  "projectChatQueueAction",
  "resumeProjectChat",
  "compactProjectChat",
  "reloadProjectChatSession",
  "rerunWorktreeSetup",
  "selectAgentWorktree",
  "resolveStoppedWork",
  "stopProjectChatPending",
  "projectChatAgents",
  "projectChatAgent",
  "stopProjectChatAgent",
  "triageProjectChat",
  "renameProjectChat",
  "regenerateProjectChatTitle",
  "markProjectChatSeen",
  "forkProjectChat",
  "rewindProjectTurn",
  "setLimitResume",
  "closeWatchNote",
  "projectChatImage",
  "projectChatReadImage",
  "projectChatQueuedImages",
  "threadNotes",
  "tickThreadNote",
  "removeThreadNote",
  "agentModels",
  "agentDefaults",
  "agentTools",
  "aiSettings",
  "newThreadAgent",
  "saveNewThreadAgent",
  "newThreadModels",
  "saveNewThreadModel",
  "newThreadRuntimeMode",
  "saveNewThreadRuntimeMode",
  "projectWorktree",
  "projectCommands",
  "providerUsage",
  "projectWorkingTree",
  "projectGitAction",
  "projectCiStatus",
  "projectMergePlan",
  "projectMergeBranch",
  "projectCommitMessage",
  "projectBranches",
  "projectChangeBranch",
  "projectHistory",
  "projectCommit",
  "projectFiles",
  "projectFile",
  "projectTasks",
  "stopProjectTask",
  "restartProjectTask",
  "pullServers",
  "hostAccount",
  "search",
  "pull",
  "pullCiStatus",
  "files",
  "reviews",
  "discussion",
  "comment",
  "submitReview",
] as const satisfies readonly ApiMethod[];

export type PhoneDesktopMethod = (typeof phoneDesktopMethods)[number];

/** What a computer does with a shell it opened in a project there, as TerminalApi names it. */
export const terminalOps = [
  "write",
  "resize",
  "ack",
  "close",
  "prefill",
  "prefillSignIn",
  "adopt",
] as const;

export type TerminalOp = (typeof terminalOps)[number];

/** The `computerCall`s that set a project up there, from `remoteAddingBridge`. */
export const computerAddingMethods = [
  "folderPreview",
  "addingStart",
  "githubRepos",
  "createProject",
  "cancelProjectAdding",
] as const satisfies readonly ApiMethod[];

/**
 * Calls about a paired computer itself, not one of its projects, that a
 * project living there needs from it (`computerCall`): project setup, its
 * agents and their models.
 */
export const computerCallMethods = [
  ...computerAddingMethods,
  "agentModels",
  "agentVersions",
  "checkAgentVersions",
  "agentSignedIn",
  "installAgent",
  "reloadAgentModels",
] as const satisfies readonly ApiMethod[];

export type ComputerCallMethod = (typeof computerCallMethods)[number];

/** What a paired computer may call; phones only `updateMethods`. */
export const computerMethods = [
  "uploadPaste",
  "downloadPaste",
  "computerProjects",
  "cloneProject",
  "setupProject",
  "setupProgress",
  "handoffUpload",
  "receiveHandoff",
  "handoffStatus",
  "handBack",
  "handoffDownload",
  "handedBack",
  "handoffAbandoned",
  "computerInfo",
  "updateNow",
  "handoffChat",
  "handoffCall",
  "computerFolders",
  "computerAddProject",
  "startInProject",
  "computerCall",
  "projectCall",
  "projectTerminal",
  "terminalCall",
] as const satisfies readonly RemoteMethod[];

export type ComputerMethod = (typeof computerMethods)[number];

export const remoteMethods = [
  "overview",
  "chat",
  "diff",
  "desktop",
  "projectIcons",
  "subagents",
  "subagentRun",
  "reportApp",
  "dictate",
  "readAloud",
  "activityDetail",
  "image",
  "renderPage",
  "news",
  "sites",
  "tunnelAllow",
  "saveDraft",
  "draftOther",
  "sendDraft",
  "uploadFile",
  ...computerMethods,
] as const satisfies readonly RemoteMethod[];

/** About this Relay itself, so a phone may ask too, from `phoneUpdatesBridge`. */
export const updateMethods = [
  "computerInfo",
  "updateNow",
] as const satisfies readonly ComputerMethod[];

/**
 * Calls that stop an agent, wait for its note or move a repository's worth
 * of Git; a dead link still fails them within a minute, as its ticks stop.
 */
export const slowRemoteMethods: readonly RemoteMethod[] = [
  // Through the desktop's page, which may have to open first, then a send's own.
  "sendDraft",
  "receiveHandoff",
  "handBack",
  "handoffUpload",
  "handoffDownload",
];

/**
 * Calls a computer forwards (`projectCall`, `handoffCall`, `computerCall`)
 * that wait on the network, git, a model or an install. Given up on early,
 * they'd still finish there, and trying again would push or open a pull
 * request twice; they get `slowRemoteMethods`' time.
 */
const slowForwardedMethods = new Set<string>([
  "addingStart",
  "githubRepos",
  "createProject",
  "projectGitAction",
  "projectCommitMessage",
  "projectPlanCommitSplit",
  "projectApplyCommitSplit",
  "projectBranchPulls",
  "projectMergePlan",
  "projectMergeBranch",
  "projectDeleteBranch",
  "projectCatchUp",
  "projectRebase",
  "projectPreparePull",
  "projectCreatePull",
  "projectChangeBranch",
  "sendProjectChat",
  "compactProjectChat",
  "rerunWorktreeSetup",
  "checkAgentVersions",
  "installAgent",
] satisfies ApiMethod[]);

/** Whether the call gets the slow timeout, by its method and, when it forwards one, that one's. */
export function slowRemoteCall(method: RemoteMethod, args: unknown[]) {
  if (slowRemoteMethods.includes(method)) return true;
  const forwarded =
    method === "computerCall"
      ? args[0]
      : method === "projectCall" || method === "handoffCall"
        ? args[1]
        : undefined;
  return typeof forwarded === "string" && slowForwardedMethods.has(forwarded);
}

/**
 * Calls that wait on the network, git or a model: pushes, pulls and merges,
 * written commit messages, CI and plan usage, and sends, which may carry
 * screenshots over a slow link and make a worktree first. The phone gives
 * them the desktop's two minutes instead of its usual quarter.
 */
export const slowPhoneMethods: readonly PhoneDesktopMethod[] = [
  "agentTools",
  "sendProjectChat",
  "createProjectChat",
  "projectGitAction",
  "projectCommitMessage",
  "projectMergePlan",
  "projectMergeBranch",
  "projectCiStatus",
  "providerUsage",
  "regenerateProjectChatTitle",
  "search",
  "pullCiStatus",
  "submitReview",
  "comment",
];

/** A desktop call's arguments and result, as the phone sees them. */
export type DesktopCall<M extends PhoneDesktopMethod> = {
  args: Parameters<Api[M]>;
  result: Awaited<ReturnType<Api[M]>>;
};
