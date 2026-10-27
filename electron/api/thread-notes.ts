import { z } from "zod";
import { idSchema } from "../../shared/validation";
import { noteIdSchema, noteTextSchema } from "../../shared/thread-notes";
import {
  messageIdSchema,
  optional,
  takes,
  type ApiContext,
  type Handlers,
} from "./context";

/** What a thread keeps in its notes: kept text, pinned messages, checklists. */
export function threadNoteHandlers(ctx: ApiContext) {
  const { projectChats } = ctx;
  return {
    threadNotes: takes([idSchema], (id) => projectChats.notes.list(id)),
    keepThreadNote: takes(
      [idSchema, noteTextSchema, optional(messageIdSchema)],
      (id, text, from) => projectChats.notes.add(id, { text, from }),
    ),
    pinThreadMessage: takes([idSchema, messageIdSchema], (id, messageId) =>
      projectChats.notes.pin(id, messageId),
    ),
    tickThreadNote: takes(
      [idSchema, noteIdSchema, z.number().int().min(1), z.boolean()],
      (id, note, item, done) => projectChats.notes.tick(id, note, item, done),
    ),
    arrangeThreadNote: takes(
      [idSchema, noteIdSchema, z.array(z.number().int().min(1)).max(500)],
      (id, note, order) => projectChats.notes.arrange(id, note, order),
    ),
    removeThreadNote: takes([idSchema, noteIdSchema], (id, note) =>
      projectChats.notes.remove(id, note),
    ),
  } satisfies Handlers;
}
