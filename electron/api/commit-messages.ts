import { z } from "zod";
import { fileChangeSchema } from "../../shared/commit-split";
import {
  helperOffMessage,
  helperOn,
  helperPickSchema,
  type HelperPick,
} from "../../shared/settings";
import { workingPathSchema } from "../../shared/working-tree";
import { parseWorkspaceId, workspaceIdSchema } from "../../shared/workspaces";
import {
  generateChangeCommitMessage,
  generateCommitMessage,
} from "../git/commit-messages";
import { takes, type ApiContext, type Handlers } from "./context";

/** Commit messages written by the helper model, for a set of files or for one change. */
export function commitMessageHandlers(ctx: ApiContext) {
  const { store, projects, placeRoot } = ctx;
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
  } satisfies Handlers;
}
