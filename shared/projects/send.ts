import { z } from "zod";
import { interactionModeSchema, runtimeModeSchema } from "../agent-modes";
import { agentProviderSchema } from "../agents";
import { accountIdSchema } from "../agent-accounts";
import { lineQuestionSchema } from "../questions";
import { aiSettingsSchema } from "../settings";
import { ultraplanKindSchema } from "../ultraplan";
import { filePathSchema, idSchema } from "../validation";

const imageMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
const pastedImageSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mimeType: imageMimeSchema,
    dataUrl: z
      .string()
      .max(1_100_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const projectChatSendSchema = z
  .object({
    delivery: z.enum(["queue", "steer"]).optional(),
    /** Send later: hold the message until this time. */
    sendAt: z.number().int().positive().optional(),
    id: idSchema,
    body: z.string().trim().min(1).max(32000),
    choice: aiSettingsSchema.shape.questions,
    /** Claude on a 200k window; left out, the CLI picks (1M on most models). */
    contextWindow: z.literal("200k").optional(),
    /** The account a new thread's agent starts on; a thread keeps its own after. */
    account: accountIdSchema.optional(),
    /**
     * The agent `choice` is for. A note still names one: desktops before
     * `recipientBridge` require it.
     */
    provider: agentProviderSchema,
    /**
     * Who answers: an agent, or "message" for a note. Left out by older
     * phones and desktops, whose body's leading mention says; see
     * shared/recipient.
     */
    to: agentProviderSchema.or(z.literal("message")).optional(),
    runtimeMode: runtimeModeSchema,
    interactionMode: interactionModeSchema,
    parentId: idSchema.nullable().optional(),
    /** Asks `/btw`: starts a side thread instead of a turn of the main one. */
    side: z.literal(true).optional(),
    viewing: filePathSchema.optional(),
    selection: lineQuestionSchema.optional(),
    images: z.array(pastedImageSchema).max(3).optional(),
    /** Plan this with a council of thinkers first; see shared/ultraplan. */
    ultraplan: ultraplanKindSchema.optional(),
    /** Sent by the agent in another thread, through Relay's tools; see electron/started-threads. */
    fromThread: z
      .object({ id: idSchema, name: z.string().trim().min(1).max(300) })
      .strict()
      .optional(),
    /** Deep review findings this message asks the lead to fix. */
    fixes: z
      .array(z.string().regex(/^F\d{1,3}$/))
      .max(50)
      .optional(),
  })
  .strict();
export type ProjectChatSend = z.infer<typeof projectChatSendSchema>;
/** Which agent carries on a stopped answer, and how; see resumeProjectChat. */
export const resumeSettingsSchema = projectChatSendSchema
  .pick({
    provider: true,
    choice: true,
    contextWindow: true,
    runtimeMode: true,
    interactionMode: true,
  })
  .strict();
export type ResumeSettings = z.infer<typeof resumeSettingsSchema>;

/** Who a message says it's from, when another thread's agent sent it. */
export const sentBy = (input: Pick<ProjectChatSend, "fromThread">) =>
  input.fromThread
    ? { author: input.fromThread.name, fromThread: input.fromThread.id }
    : {};
