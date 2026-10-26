import { z } from "zod";
import {
  deepReviewStartSchema,
  MAX_REVIEWERS,
  reviewSetupSchema,
  savedReviewSetupSchema,
} from "../../shared/deep-review";
import { idSchema } from "../../shared/validation";
import { nameReviewSetup } from "../deep-review/review-setup-names";
import { forgePulls } from "../deep-review/pull-info";
import { takes, type ApiContext, type Handlers } from "./context";

/** Deep reviews: starting and resuming them, their setups, and their findings. */
export function deepReviewHandlers(ctx: ApiContext) {
  const { store, projectChats, clientFor } = ctx;
  return {
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
