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
import { idSchema } from "../../shared/validation";
import { gitActionSchema, workingPathSchema } from "../../shared/working-tree";
import { workspaceIdSchema } from "../../shared/workspaces";
import {
  catchUpBranch,
  deleteMergedBranch,
  mergeBranch,
  mergePlan,
} from "../git/branch-merge";
import { rebaseOnUpstream } from "../git/branch-rebase";
import { branches, changeBranch } from "../git/branches";
import { generateCommitMessage } from "../git/commit-messages";
import { applyCommitSplit, planCommitSplit } from "../git/commit-split";
import { commitDetail, commitDiff, commitLog } from "../git/history";
import {
  performGitAction,
  workingDiff,
  workingTree,
} from "../git/working-tree";
import { dismissIgnored, ignoredDiff } from "../git/ignored-touches";
import { takes, type ApiContext, type Handlers } from "./context";

const branchNameSchema = z.string().min(1).max(250);

/** Git in a project's checkout or a thread's worktree: changes, history, branches, commits. */
export function gitHandlers(ctx: ApiContext) {
  const { store, projects, projectChats, projectChecks, placeRoot } = ctx;
  return {
    projectWorkingTree: takes([workspaceIdSchema], async (where) =>
      workingTree(await placeRoot(where)),
    ),
    projectWorkingDiff: takes(
      [workspaceIdSchema, workingPathSchema, z.enum(["staged", "unstaged"])],
      async (where, path, area) =>
        workingDiff(await placeRoot(where), path, area),
    ),
    projectIgnoredDiff: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => ignoredDiff(await placeRoot(where), path),
    ),
    projectDismissIgnored: takes(
      [workspaceIdSchema, z.array(workingPathSchema).min(1).max(1000)],
      async (where, paths) => {
        const root = await placeRoot(where);
        await dismissIgnored(root, paths);
        return workingTree(root);
      },
    ),
    projectHistory: takes(
      [workspaceIdSchema, historyScopeSchema, historyLimitSchema],
      async (where, scope, limit) =>
        commitLog(await placeRoot(where), scope, limit),
    ),
    projectCommit: takes(
      [workspaceIdSchema, commitShaSchema],
      async (where, sha) => commitDetail(await placeRoot(where), sha),
    ),
    projectCommitDiff: takes(
      [workspaceIdSchema, commitShaSchema, workingPathSchema],
      async (where, sha, path) => commitDiff(await placeRoot(where), sha, path),
    ),
    projectBranches: takes([idSchema], async (id) =>
      branches(await projects.root(id)),
    ),
    projectChangeBranch: takes(
      [idSchema, branchActionSchema],
      async (id, action) => {
        projects.assertCheckoutAvailable(id);
        projects.changingBranch.add(id);
        try {
          const root = await projects.root(id);
          if (projectChats.hasActiveProject(id))
            throw new Error(
              "Stop the running agent in this project before switching branches.",
            );
          const result = await changeBranch(root, action);
          projectChecks.stop();
          return result;
        } finally {
          projects.changingBranch.delete(id);
        }
      },
    ),
    projectMergePlan: takes(
      [workspaceIdSchema, branchNameSchema.optional()],
      async (where, base) => mergePlan(await placeRoot(where), base),
    ),
    projectMergeBranch: takes(
      [workspaceIdSchema, mergeBranchSchema],
      async (where, input) => mergeBranch(await placeRoot(where), input),
    ),
    projectCatchUp: takes(
      [workspaceIdSchema, branchNameSchema],
      async (where, base) => catchUpBranch(await placeRoot(where), base),
    ),
    projectRebase: takes(
      [workspaceIdSchema, z.string().regex(/^[0-9a-f]{40,64}$/)],
      async (where, upstream) =>
        rebaseOnUpstream(await placeRoot(where), upstream),
    ),
    projectDeleteBranch: takes(
      [workspaceIdSchema, branchNameSchema],
      async (where, name) => deleteMergedBranch(await placeRoot(where), name),
    ),
    projectCommitMessage: takes(
      [workspaceIdSchema, z.array(workingPathSchema).min(1).max(1000)],
      async (where, paths) =>
        generateCommitMessage(
          await placeRoot(where),
          paths,
          store.aiSettings(),
          AbortSignal.timeout(120_000),
        ),
    ),
    projectPlanCommitSplit: takes(
      [workspaceIdSchema, commitSplitNoteSchema.optional()],
      async (where, note) =>
        planCommitSplit(
          await placeRoot(where),
          note ?? "",
          store.aiSettings(),
          // Planning reads every change at the chosen effort; give it room.
          AbortSignal.timeout(600_000),
        ),
    ),
    projectApplyCommitSplit: takes(
      [workspaceIdSchema, applyCommitSplitSchema],
      async (where, split) => applyCommitSplit(await placeRoot(where), split),
    ),
    projectGitAction: takes(
      [workspaceIdSchema, gitActionSchema],
      async (where, action) =>
        performGitAction(await placeRoot(where), action, (file) =>
          shell.trashItem(file),
        ),
    ),
  } satisfies Handlers;
}
