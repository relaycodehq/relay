/** Which API calls a live handoff or a project on another computer runs there; see shared/handoff. */
import type { ApiMethod } from "./types";

/**
 * Calls on a thread, its id first, that a live handoff runs on the computer
 * the thread is on. The rest (reading it, triage, notes, its name) stay here.
 */
export const handoffChatMethods = [
  "sendProjectChat",
  "resumeProjectChat",
  "compactProjectChat",
  "reloadProjectChatSession",
  "rerunWorktreeSetup",
  "projectChatQueueAction",
  "respondProjectChat",
  "answerProjectChatQuestion",
  "setProjectChatQuestionDismissed",
  "cancelProjectChat",
  "resolveStoppedWork",
  "setLimitResume",
  "stopProjectChatPending",
  "projectChatAgents",
  "projectChatContext",
  "projectChatAgent",
  "stopProjectChatAgent",
  "projectChatImage",
  "projectChatQueuedImages",
  "projectChatReadImage",
  "closeWatchNote",
  "seePrediction",
] as const satisfies readonly ApiMethod[];
export type HandoffChatMethod = (typeof handoffChatMethods)[number];

/**
 * Calls on the folder a live handoff's thread works in, its workspace id
 * first: its changes, files, history and Git actions. They run on the
 * computer the thread is on from `folderHandoffBridge`, against the worktree
 * there; with an older one they stay here.
 */
export const handoffFolderMethods = [
  "projectWorkingTree",
  "projectWorkingDiff",
  "projectIgnoredDiff",
  "projectDismissIgnored",
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
  "projectHistory",
  "projectCommit",
  "projectCommitDiff",
  "projectFiles",
  "searchProjectText",
  "replaceProjectText",
  "projectFileInfo",
  "projectDirectory",
  "projectImage",
  "projectFile",
  "projectFilePreview",
  "saveProjectFile",
  "localHistoryList",
  "localHistoryRead",
  "localHistoryRecord",
  "localHistoryRevert",
  "createProjectEntry",
  "renameProjectEntry",
  "trashProjectEntry",
  "localBlame",
  "inspectLocalSymbol",
] as const satisfies readonly ApiMethod[];
/**
 * Calls about a project that lives on another computer (`Project.computer`),
 * its id first, that run on that computer (`projectCall`): its checkout's
 * folder calls, and its branches, commands, agents' defaults, icon and tasks.
 */
export const remoteProjectMethods = [
  ...handoffFolderMethods,
  "projectBranches",
  "projectBranchCounts",
  "projectBranchChanges",
  "projectChangeBranch",
  "projectCommands",
  "agentDefaults",
  "projectIcon",
  "projectTasks",
  "stopProjectTask",
  "restartProjectTask",
] as const satisfies readonly ApiMethod[];
export type RemoteProjectMethod = (typeof remoteProjectMethods)[number];
/**
 * Calls on a live handoff's worktree, the thread's id first, that run there
 * from `folderHandoffBridge` too; so do the files its agents changed in
 * other repositories, which are on that computer's disk.
 */
export const handoffWorktreeMethods = [
  "projectWorktree",
  "projectWorktreeDiff",
  "threadElsewhere",
  "threadElsewhereDiff",
  "threadElsewhereCommit",
] as const satisfies readonly ApiMethod[];
/**
 * Calls that open or point at a thread's files on this computer's disk. For a
 * live handoff's thread they'd open the copy it left behind, so they're
 * refused; its folder argument or id comes first, as above.
 */
export const handoffHereOnlyMethods = [
  "projectAbsolutePath",
  "revealProjectPath",
  "openProjectPath",
  "revealProjectWorktree",
] as const satisfies readonly ApiMethod[];
export type HandoffHereOnlyMethod = (typeof handoffHereOnlyMethods)[number];
export type HandoffMethod =
  | HandoffChatMethod
  | (typeof handoffFolderMethods)[number]
  | (typeof handoffWorktreeMethods)[number];
/** Every call a live handoff runs on the other computer. */
export const handoffMethods = [
  ...handoffChatMethods,
  ...handoffFolderMethods,
  ...handoffWorktreeMethods,
] as const satisfies readonly HandoffMethod[];
