import { shell } from "electron";
import { z } from "zod";
import { mergeBranchSchema } from "../../shared/branch-merge";
import { branchActionSchema } from "../../shared/branches";
import {
  applyCommitSplitSchema,
  commitSplitNoteSchema,
} from "../../shared/commit-split";
import {
  commitShaSchema,
  historyLimitSchema,
  historyScopeSchema,
} from "../../shared/history";
import { idSchema } from "../../shared/rooms";
import { gitActionSchema, workingPathSchema } from "../../shared/working-tree";
import {
  catchUpBranch,
  deleteMergedBranch,
  mergeBranch,
  mergePlan,
} from "../branch-merge";
import { branches, changeBranch } from "../branches";
import { generateCommitMessage } from "../commit-messages";
import { applyCommitSplit, planCommitSplit } from "../commit-split";
import { commitDetail, commitDiff, commitLog } from "../history";
import { performGitAction, workingDiff, workingTree } from "../working-tree";
import type { ApiContext, Handlers } from "./context";

/** Git in a project's checkout or a thread's worktree: changes, history, branches, commits. */
export function gitHandlers(ctx: ApiContext) {
  const { store, projects, projectChats, projectChecks, liveSyncs, placeRoot } =
    ctx;
  return {
    projectWorkingTree: async (args) => workingTree(await placeRoot(args[0])),
    projectWorkingDiff: async (args) =>
      workingDiff(
        await placeRoot(args[0]),
        workingPathSchema.parse(args[1]),
        z.enum(["staged", "unstaged"]).parse(args[2]),
      ),
    projectHistory: async (args) =>
      commitLog(
        await placeRoot(args[0]),
        historyScopeSchema.parse(args[1]),
        historyLimitSchema.parse(args[2]),
      ),
    projectCommit: async (args) =>
      commitDetail(await placeRoot(args[0]), commitShaSchema.parse(args[1])),
    projectCommitDiff: async (args) =>
      commitDiff(
        await placeRoot(args[0]),
        commitShaSchema.parse(args[1]),
        workingPathSchema.parse(args[2]),
      ),
    projectBranches: async (args) =>
      branches(await projects.root(idSchema.parse(args[0]))),
    projectChangeBranch: async (args) => {
      const id = idSchema.parse(args[0]);
      const action = branchActionSchema.parse(args[1]);
      projects.assertCheckoutAvailable(id);
      projects.changingBranch.add(id);
      try {
        const root = await projects.root(id);
        if (projectChats.hasActiveProject(id))
          throw new Error(
            "Stop the running agent in this project before switching branches.",
          );
        if (liveSyncs.busy(root))
          throw new Error("Pause live file sync before switching branches.");
        const result = await changeBranch(root, action);
        projectChecks.stop();
        return result;
      } finally {
        projects.changingBranch.delete(id);
      }
    },
    projectMergePlan: async (args) =>
      mergePlan(
        await placeRoot(args[0]),
        z.string().min(1).max(250).optional().parse(args[1]),
      ),
    projectMergeBranch: async (args) =>
      mergeBranch(await placeRoot(args[0]), mergeBranchSchema.parse(args[1])),
    projectCatchUp: async (args) =>
      catchUpBranch(
        await placeRoot(args[0]),
        z.string().min(1).max(250).parse(args[1]),
      ),
    projectDeleteBranch: async (args) =>
      deleteMergedBranch(
        await placeRoot(args[0]),
        z.string().min(1).max(250).parse(args[1]),
      ),
    projectCommitMessage: async (args) =>
      generateCommitMessage(
        await placeRoot(args[0]),
        z.array(workingPathSchema).min(1).max(1000).parse(args[1]),
        store.aiSettings(),
        AbortSignal.timeout(120_000),
      ),
    projectPlanCommitSplit: async (args) =>
      planCommitSplit(
        await placeRoot(args[0]),
        commitSplitNoteSchema.optional().parse(args[1]) ?? "",
        store.aiSettings(),
        // Planning reads every change at the chosen effort; give it room.
        AbortSignal.timeout(600_000),
      ),
    projectApplyCommitSplit: async (args) =>
      applyCommitSplit(
        await placeRoot(args[0]),
        applyCommitSplitSchema.parse(args[1]),
      ),
    projectGitAction: async (args) =>
      performGitAction(
        await placeRoot(args[0]),
        gitActionSchema.parse(args[1]),
        (file) => shell.trashItem(file),
      ),
  } satisfies Handlers;
}
