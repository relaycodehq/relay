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
import { pageSchema, type ApiContext, type Handlers } from "./context";

type TriageMethod =
  "triageState" | "startTriage" | "cancelTriage" | "groupPaths";

/** Reviewing a Gitea pull request: finding it, its files and discussion, the review itself. */
export function reviewHandlers(ctx: ApiContext) {
  const { store, triage, requireClient, prKey, projectChats } = ctx;

  async function triageCall(args: unknown[], method: TriageMethod) {
    const ref = refSchema.parse(args[0]),
      head = shaSchema.parse(args[1]),
      base = shaSchema.parse(args[2]),
      key = prKey(ref);
    if (method === "triageState") return triage.state(key, `${base}:${head}`);
    if (method === "startTriage")
      return triage.start(requireClient(), ref, key, head, base);
    if (method === "groupPaths")
      return triage.groupPaths(
        requireClient(),
        ref,
        key,
        head,
        base,
        z.string().max(100).parse(args[3]),
      );
    const state = await triage.state(key, `${base}:${head}`);
    if (
      state?.status === "scanning" ||
      state?.status === "classifying" ||
      state?.status === "matching"
    )
      triage.cancel();
    return;
  }

  return {
    search: (args) => {
      const filter = z
          .enum(["review_requested", "assigned", "created", "all"])
          .parse(args[0]),
        q = z.string().max(500).parse(args[1]),
        state = z.enum(["open", "closed", "all"]).parse(args[2]),
        page = pageSchema.parse(args[3]);
      const query = new URLSearchParams({
        type: "pulls",
        state,
        q,
        ...(filter === "all" ? {} : { [filter]: "true" }),
      });
      return requireClient().page<Issue>(`/repos/issues/search?${query}`, page);
    },
    parseUrl: (args) =>
      requireClient().parseUrl(z.string().max(4096).parse(args[0])),
    pull: (args) => requireClient().pull(refSchema.parse(args[0])),
    files: (args) => {
      const r = refSchema.parse(args[0]);
      return requireClient().files(r, pageSchema.parse(args[1]));
    },
    contents: (args) => {
      const r = refSchema.parse(args[0]),
        file = z
          .object({
            filename: filePathSchema,
            previous_filename: filePathSchema.optional(),
            status: z.string().max(30),
            additions: z.number(),
            deletions: z.number(),
            changes: z.number(),
          })
          .parse(args[1]);
      return requireClient().contents(
        r,
        file,
        shaSchema.parse(args[2]),
        shaSchema.parse(args[3]),
      );
    },
    changedBetween: (args) =>
      requireClient().changedBetween(
        refSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        shaSchema.parse(args[2]),
      ),
    reviews: (args) => {
      const r = refSchema.parse(args[0]);
      return requireClient().reviews(r, pageSchema.parse(args[1]));
    },
    reviewComments: (args) => {
      const r = refSchema.parse(args[0]);
      return requireClient().reviewComments(
        r,
        z.number().int().positive().parse(args[1]),
      );
    },
    discussion: (args) => {
      const r = refSchema.parse(args[0]);
      return requireClient().discussion(r, pageSchema.parse(args[1]));
    },
    progress: (args) =>
      store.get().progress[prKey(refSchema.parse(args[0]))] ?? emptyProgress(),
    saveProgress: async (args) => {
      const key = prKey(refSchema.parse(args[0])),
        progress = progressSchema.parse(args[1]);
      await store.update((s) => {
        s.progress[key] = progress;
      });
      // An unused PR thread lists once its review begins; see listChats.
      for (const c of store.get().chats ?? [])
        if (c.scope.kind === "pr" && prKey(c.scope.ref) === key)
          projectChats.summariesChanged(c.projectId);
    },
    submitReview: (args) =>
      requireClient().submit(
        refSchema.parse(args[0]),
        shaSchema.parse(args[1]),
        z.enum(["COMMENT", "APPROVED", "REQUEST_CHANGES"]).parse(args[2]),
        z.string().max(65536).parse(args[3]),
        z.array(draftSchema).max(1000).parse(args[4]),
      ),
    resolveComment: async (args) => {
      const r = refSchema.parse(args[0]);
      await requireClient().resolveComment(
        r,
        z.number().int().positive().parse(args[1]),
        z.boolean().parse(args[2]),
      );
    },
    reply: (args) => {
      const r = refSchema.parse(args[0]);
      return requireClient().reply(
        r,
        z.number().int().positive().parse(args[1]),
        bodySchema.parse(args[2]),
      );
    },
    comment: (args) => {
      const r = refSchema.parse(args[0]);
      return requireClient().comment(r, bodySchema.parse(args[1]));
    },
    triageState: triageCall,
    startTriage: triageCall,
    cancelTriage: triageCall,
    groupPaths: triageCall,
  } satisfies Handlers;
}
