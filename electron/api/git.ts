import { shell } from "electron";
import { z } from "zod";
import { mergeBranchSchema } from "../../shared/branch-merge";
import { branchActionSchema } from "../../shared/branches";
import {
  applyCommitSplitSchema,
  commitFileChangeSchema,
  commitSplitNoteSchema,
  fileChangeSchema,
} from "../../shared/commit-split";
import {
  commitShaSchema,
  historyLimitSchema,
  historyScopeSchema,
} from "../../shared/history";
import {
  helperOffMessage,
  helperOn,
  helperPickSchema,
  type HelperPick,
} from "../../shared/settings";
import { idSchema } from "../../shared/validation";
import { gitActionSchema, workingPathSchema } from "../../shared/working-tree";
import { parseWorkspaceId, workspaceIdSchema } from "../../shared/workspaces";
import {
  catchUpBranch,
  deleteMergedBranch,
  mergeBranch,
  mergePlan,
} from "../git/branch-merge";
import { rebaseOnUpstream } from "../git/branch-rebase";
import {
  branchChanges,
  branchCounts,
  branches,
  changeBranch,
} from "../git/branches";
import { commitFileChange } from "../git/commit-change";
import {
  generateChangeCommitMessage,
  generateCommitMessage,
} from "../git/commit-messages";
import { applyCommitSplit, planCommitSplit } from "../git/commit-split";
import { commitDetail, commitDiff, commitLog } from "../git/history";
import { performGitAction } from "../git/git-actions";
import { workingDiff } from "../git/working-diff";
import { workingTree } from "../git/working-tree";
import { dismissIgnored, ignoredDiff } from "../git/ignored-touches";
import { takes, type ApiContext, type Handlers } from "./context";

const branchNameSchema = z.string().min(1).max(250);

/** Git in a project's checkout or a thread's worktree: changes, history, branches, commits. */
export function gitHandlers(ctx: ApiContext) {
  const { store, projects, projectChats, projectChecks, placeRoot } = ctx;
  /** What writes a commit message here: `picked`, else the project's own pick, else the app's. */
  const commitMessageSettings = (where: string, picked?: HelperPick | null) => {
    const settings = store.aiSettings();
    if (!helperOn(settings, "commitMessage"))
      throw new Error(helperOffMessage("Commit messages"));
    const pick =
      picked === undefined
        ? projects.get(parseWorkspaceId(where).projectId).settings
            ?.commitMessage
        : picked;
    return pick
      ? {
          ...settings,
          commitMessage: pick.choice,
          commitMessageProvider: pick.provider,
        }
      : settings;
  };
  return {
    projectWorkingTree: takes([workspaceIdSchema], async (where) =>
      workingTree(await placeRoot(where)),
    ),
    watchWorkingTree: takes([workspaceIdSchema.nullable()], async (where) => {
      const owner = ctx.window.caller();
      return !!owner && !!ctx.treeWatch && ctx.treeWatch.show(owner, where);
    }),
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
    projectBranchCounts: takes([idSchema], async (id) =>
      branchCounts(await projects.root(id)),
    ),
    projectBranchChanges: takes(
      [idSchema, branchNameSchema],
      async (id, branch) => branchChanges(await projects.root(id), branch),
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
      async (where, input) => {
        const result = await mergeBranch(await placeRoot(where), input);
        const { chatId } = parseWorkspaceId(where);
        if (result.merged && chatId)
          await projectChats.worktrees.branchMerged(chatId, input.branch);
        return result;
      },
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
      [
        workspaceIdSchema,
        z.array(workingPathSchema).min(1).max(1000),
        // The sheet's own pick, which may not have finished saving yet.
        helperPickSchema.nullable().optional(),
      ],
      async (where, paths, picked) => {
        const settings = commitMessageSettings(where, picked);
        return generateCommitMessage(
          await placeRoot(where),
          paths,
          settings,
          AbortSignal.timeout(120_000),
        );
      },
    ),
    projectChangeCommitMessage: takes(
      [workspaceIdSchema, fileChangeSchema],
      async (where, change) => {
        const settings = commitMessageSettings(where);
        return generateChangeCommitMessage(
          await placeRoot(where),
          change,
          settings,
          AbortSignal.timeout(120_000),
        );
      },
    ),
    projectPlanCommitSplit: takes(
      [workspaceIdSchema, commitSplitNoteSchema.optional()],
      async (where, note) => {
        const settings = store.aiSettings();
        if (!helperOn(settings, "split"))
          throw new Error(helperOffMessage("Commit splits"));
        return planCommitSplit(
          await placeRoot(where),
          note ?? "",
          settings,
          // Planning reads every change at the chosen effort; give it room.
          AbortSignal.timeout(600_000),
        );
      },
    ),
    projectApplyCommitSplit: takes(
      [workspaceIdSchema, applyCommitSplitSchema],
      async (where, split) => applyCommitSplit(await placeRoot(where), split),
    ),
    projectCommitFileChange: takes(
      [workspaceIdSchema, commitFileChangeSchema],
      async (where, change) => commitFileChange(await placeRoot(where), change),
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
