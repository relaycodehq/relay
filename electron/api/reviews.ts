import { z } from "zod";
import { emptyProgress, type Issue } from "../../shared/types";
import {
  bodySchema,
  draftSchema,
  filePathSchema,
  progressSchema,
  refSchema,
  shaSchema,
} from "../../shared/validation";
import { pageSchema, takes, type ApiContext, type Handlers } from "./context";

/** Reviewing a Gitea pull request: finding it, its files and discussion, the review itself. */
export function reviewHandlers(ctx: ApiContext) {
  const { store, triage, requireClient, prKey, projectChats } = ctx;

  const triageArgs = [refSchema, shaSchema, shaSchema] as const;

  return {
    search: takes(
      [
        z.enum(["review_requested", "assigned", "created", "all"]),
        z.string().max(500),
        z.enum(["open", "closed", "all"]),
        pageSchema,
      ],
      (filter, q, state, page) => {
        const query = new URLSearchParams({
          type: "pulls",
          state,
          q,
          ...(filter === "all" ? {} : { [filter]: "true" }),
        });
        return requireClient().page<Issue>(
          `/repos/issues/search?${query}`,
          page,
        );
      },
    ),
    parseUrl: takes([z.string().max(4096)], (url) =>
      requireClient().parseUrl(url),
    ),
    pull: takes([refSchema], (r) => requireClient().pull(r)),
    files: takes([refSchema, pageSchema], (r, page) =>
      requireClient().files(r, page),
    ),
    contents: takes(
      [
        refSchema,
        z.object({
          filename: filePathSchema,
          previous_filename: filePathSchema.optional(),
          status: z.string().max(30),
          additions: z.number(),
          deletions: z.number(),
          changes: z.number(),
        }),
        shaSchema,
        shaSchema,
      ],
      (r, file, head, base) => requireClient().contents(r, file, head, base),
    ),
    changedBetween: takes([refSchema, shaSchema, shaSchema], (r, from, to) =>
      requireClient().changedBetween(r, from, to),
    ),
    reviews: takes([refSchema, pageSchema], (r, page) =>
      requireClient().reviews(r, page),
    ),
    reviewComments: takes([refSchema, z.number().int().positive()], (r, id) =>
      requireClient().reviewComments(r, id),
    ),
    discussion: takes([refSchema, pageSchema], (r, page) =>
      requireClient().discussion(r, page),
    ),
    progress: takes(
      [refSchema],
      (r) => store.get().progress[prKey(r)] ?? emptyProgress(),
    ),
    saveProgress: takes([refSchema, progressSchema], async (r, progress) => {
      const key = prKey(r);
      await store.update((s) => {
        s.progress[key] = progress;
      });
      // An unused PR thread lists once its review begins; see listChats.
      for (const c of store.get().chats ?? [])
        if (c.scope.kind === "pr" && prKey(c.scope.ref) === key)
          projectChats.summariesChanged(c.projectId);
    }),
    submitReview: takes(
      [
        refSchema,
        shaSchema,
        z.enum(["COMMENT", "APPROVED", "REQUEST_CHANGES"]),
        z.string().max(65536),
        z.array(draftSchema).max(1000),
      ],
      (r, head, event, body, drafts) =>
        requireClient().submit(r, head, event, body, drafts),
    ),
    resolveComment: takes(
      [refSchema, z.number().int().positive(), z.boolean()],
      async (r, id, resolved) => {
        await requireClient().resolveComment(r, id, resolved);
      },
    ),
    reply: takes(
      [refSchema, z.number().int().positive(), bodySchema],
      async (r, id, body) => {
        await requireClient().reply(r, id, body);
      },
    ),
    comment: takes([refSchema, bodySchema], async (r, body) => {
      await requireClient().comment(r, body);
    }),
    triageState: takes(triageArgs, (r, head, base) =>
      triage.state(prKey(r), `${base}:${head}`),
    ),
    startTriage: takes(triageArgs, (r, head, base) =>
      triage.start(requireClient(), r, prKey(r), head, base),
    ),
    groupPaths: takes(
      [...triageArgs, z.string().max(100)],
      (r, head, base, id) =>
        triage.groupPaths(requireClient(), r, prKey(r), head, base, id),
    ),
    cancelTriage: takes(triageArgs, async (r, head, base) => {
      const state = await triage.state(prKey(r), `${base}:${head}`);
      if (
        state?.status === "scanning" ||
        state?.status === "classifying" ||
        state?.status === "matching"
      )
        triage.cancel();
    }),
  } satisfies Handlers;
}
