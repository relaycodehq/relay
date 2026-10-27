import { z } from "zod";
import {
  deepReviewStartSchema,
  MAX_REVIEWERS,
  reviewTargetSchema,
  reviewSetupSchema,
  savedReviewSetupSchema,
} from "../../shared/deep-review";
import { idSchema } from "../../shared/validation";
import { nameReviewSetup } from "../deep-review/review-setup-names";
import { forgePulls } from "../deep-review/pull-info";
import { targetFiles } from "../deep-review/scope";
import { branchFolder } from "../deep-review/checkout";
import { git } from "../git/git";
import { commitLog } from "../git/history";
import { optional, takes, type ApiContext, type Handlers } from "./context";

const branchSchema = z.string().trim().min(1).max(250);

/** Deep reviews: starting and resuming them, their setups, and their findings. */
export function deepReviewHandlers(ctx: ApiContext) {
  const { store, projects, projectChats, clientFor } = ctx;
  return {
    deepReviewFiles: takes(
      [idSchema, reviewTargetSchema, optional(branchSchema)],
      async (projectId, target, on) => {
        const pull =
          target.kind === "pr"
            ? await forgePulls(clientFor)(target.ref)
            : undefined;
        const root = await projects.root(projectId);
        return targetFiles(
          on ? (await branchFolder(root, on)).path : root,
          target,
          projects.get(projectId),
          pull,
        );
      },
    ),
    deepReviewFolder: takes(
      [idSchema, branchSchema],
      async (projectId, branch) => {
        const { path } = await branchFolder(
          await projects.root(projectId),
          branch,
        );
        const [status, log] = await Promise.all([
          git(path, ["status", "--porcelain", "--untracked-files=all"]),
          commitLog(path, "head", 40),
        ]);
        return {
          changes: status.split("\n").filter(Boolean).length,
          commits: log.commits,
        };
      },
    ),
    startDeepReview: takes([idSchema, deepReviewStartSchema], (id, config) =>
      projectChats.startDeepReview(id, config, {
        pull: forgePulls(clientFor),
      }),
    ),
    nameReviewSetup: takes([reviewSetupSchema], (setup) =>
      nameReviewSetup(setup, store.aiSettings(), AbortSignal.timeout(60_000)),
    ),
    saveReviewSetups: takes(
      [z.array(savedReviewSetupSchema).max(100)],
      (setups) =>
        store.update((s) => {
          s.reviewSetups = setups;
        }),
    ),
    resumeDeepReview: takes(
      [
        idSchema,
        z
          .union([
            z
              .object({
                slot: z
                  .number()
                  .int()
                  .min(0)
                  .max(MAX_REVIEWERS - 1),
              })
              .strict(),
            z.object({ lead: z.literal(true) }).strict(),
          ])
          .optional(),
      ],
      (id, only) => projectChats.resumeDeepReview(id, only),
    ),
    setFinding: takes(
      [idSchema, z.string().regex(/^F\d{1,6}$/), z.enum(["open", "dismissed"])],
      (id, findingId, status) => projectChats.setFinding(id, findingId, status),
    ),
  } satisfies Handlers;
}
