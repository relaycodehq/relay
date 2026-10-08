import { z } from "zod";
import { emptyProgress, type Issue } from "../../shared/types";
import {
  bodySchema,
  draftSchema,
  filePathSchema,
  progressSchema,
  isGithubPullUrl,
  parseGithubPullUrl,
  refSchema,
  shaSchema,
} from "../../shared/validation";
import { isGithubServer } from "../../shared/source-control";
import { pageSchema, takes, type ApiContext, type Handlers } from "./context";

/** Reviewing a pull request on GitHub or Gitea: finding it, its files and discussion, the review itself. */
export function reviewHandlers(ctx: ApiContext) {
  const { store, triage, requireClient, clientFor, prKey, projectChats } =
    ctx;

  const triageArgs = [refSchema, shaSchema, shaSchema] as const;

  return {
    search: takes(
      [
        z.enum(["review_requested", "assigned", "created", "all"]),
        z.string().max(500),
        z.enum(["open", "closed", "all"]),
        pageSchema,
        z.string().url().max(2048).optional(),
      ],
      async (filter, q, state, page, server) => {
        if (isGithubServer(server))
          return (await ctx.github.require()).search(filter, q, state, page);
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
      isGithubPullUrl(url) ? parseGithubPullUrl(url) : requireClient().parseUrl(url),
    ),
    pull: takes([refSchema], async (r) => (await clientFor(r)).pull(r)),
    files: takes([refSchema, pageSchema], async (r, page) =>
      (await clientFor(r)).files(r, page),
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
      async (r, file, head, base) => (await clientFor(r)).contents(r, file, head, base),
    ),
    changedBetween: takes([refSchema, shaSchema, shaSchema], async (r, from, to) =>
      (await clientFor(r)).changedBetween(r, from, to),
    ),
    reviews: takes([refSchema, pageSchema], async (r, page) =>
      (await clientFor(r)).reviews(r, page),
    ),
    reviewComments: takes([refSchema, z.number().int().positive()], async (r, id) =>
      (await clientFor(r)).reviewComments(r, id),
    ),
    discussion: takes([refSchema, pageSchema], async (r, page) =>
      (await clientFor(r)).discussion(r, page),
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
      async (r, head, event, body, drafts) =>
        (await clientFor(r)).submit(r, head, event, body, drafts),
    ),
    resolveComment: takes(
      [refSchema, z.number().int().positive(), z.boolean()],
      async (r, id, resolved) => {
        await (await clientFor(r)).resolveComment(r, id, resolved);
      },
    ),
    reply: takes(
      [refSchema, z.number().int().positive(), bodySchema],
      async (r, id, body) => {
        await (await clientFor(r)).reply(r, id, body);
      },
    ),
    comment: takes([refSchema, bodySchema], async (r, body) => {
      await (await clientFor(r)).comment(r, body);
    }),
    triageState: takes(triageArgs, (r, head, base) =>
      triage.state(prKey(r), `${base}:${head}`),
    ),
    startTriage: takes(triageArgs, async (r, head, base) =>
      triage.start(await clientFor(r), r, prKey(r), head, base),
    ),
    groupPaths: takes(
      [...triageArgs, z.string().max(100)],
      async (r, head, base, id) =>
        triage.groupPaths(await clientFor(r), r, prKey(r), head, base, id),
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
