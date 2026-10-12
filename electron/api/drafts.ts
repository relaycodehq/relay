import { z } from "zod";
import { draftKeySchema, draftWriteSchema } from "../../shared/drafts";
import { takes, type ApiContext, type Handlers } from "./context";

const heldResultSchema = z.union([
  z.object({ chatId: z.string().uuid() }).strict(),
  z.object({ error: z.string().max(2000) }).strict(),
]);

/** The drafts this computer shares with its phones; see shared/drafts. */
export function draftHandlers(ctx: ApiContext) {
  const { drafts } = ctx;
  return {
    sharedDrafts: () => drafts.list(),
    writeSharedDrafts: takes([z.array(draftWriteSchema).max(100)], (writes) =>
      writes.map((write) => drafts.write(write, "desktop")),
    ),
    sharedDraftOther: takes([draftKeySchema, z.boolean()], (key, drop) =>
      drafts.other(key, drop),
    ),
    waitingDraftSends: () => drafts.waitingSends(),
    finishDraftSend: takes([z.string().uuid(), heldResultSchema], (id, result) =>
      drafts.finishSend(id, result),
    ),
  } satisfies Handlers;
}
