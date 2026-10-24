import { z } from "zod";
import { interactionModeSchema, runtimeModeSchema } from "../agent-modes";
import { agentProviderSchema } from "../agents";
import { accountIdSchema } from "../agent-accounts";
import { lineQuestionSchema } from "../questions";
import { aiSettingsSchema } from "../settings";
import { filePathSchema, idSchema } from "../validation";
import { recipient } from "../recipient";
import { browserAnnotationSchema } from "../browser-annotations";
import { scheduleMessageSchema } from "../schedules";

const imageMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
const pastedImageSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mimeType: imageMimeSchema,
    browser: browserAnnotationSchema.optional(),
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
    /**
     * Overrides automatic compaction for this message when the cache went
     * cold: true compacts first, false sends as is. Left out, Settings decide.
     */
    compact: z.boolean().optional(),
    /** Asks `/btw`: starts a side thread instead of a turn of the main one. */
    side: z.literal(true).optional(),
    viewing: filePathSchema.optional(),
    selection: lineQuestionSchema.optional(),
    images: z.array(pastedImageSchema).optional(),
    /** Sent by the agent in another thread, through Relay's tools; see electron/started-threads. */
    fromThread: z
      .object({ id: idSchema, name: z.string().trim().min(1).max(300) })
      .strict()
      .optional(),
    /** Sent by Relay for one of the user's schedules; see shared/schedules. */
    scheduled: scheduleMessageSchema.optional(),
    /** Answers a page the agent asked with; see PageAnswer. */
    pageAnswer: z
      .object({
        title: z.string().trim().min(1).max(120),
        skipped: z.literal(true).optional(),
      })
      .strict()
      .optional(),
    /** The response is displayed under the original question instead of as a message. */
    asyncQuestionAnswer: z.literal(true).optional(),
    questionMessageId: z.string().min(1).optional(),
    /** Skills picked as pills in the composer, shown as pills again once sent. */
    skills: z
      .array(
        z
          .object({
            name: z
              .string()
              .regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/)
              .max(200),
            label: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .max(20)
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

/** Only the settings an agent actually receives; notes have none. */
export function sentSettingsOf(
  input: ProjectChatSend,
): ResumeSettings | undefined {
  const provider = recipient(input);
  if (provider === "message") return;
  return {
    provider,
    choice: input.choice,
    ...(input.contextWindow ? { contextWindow: input.contextWindow } : {}),
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
  };
}

/** A message's sending thread or schedule, question/page response markers, and skill pills. */
export const sentBy = (
  input: Pick<
    ProjectChatSend,
    | "fromThread"
    | "scheduled"
    | "pageAnswer"
    | "asyncQuestionAnswer"
    | "questionMessageId"
    | "skills"
  >,
) => ({
  ...(input.skills?.length ? { skills: input.skills } : {}),
  ...(input.fromThread
    ? { author: input.fromThread.name, fromThread: input.fromThread.id }
    : {}),
  ...(input.scheduled ? { scheduled: input.scheduled } : {}),
  ...(input.pageAnswer ? { pageAnswer: input.pageAnswer } : {}),
  ...(input.asyncQuestionAnswer ? { asyncQuestionAnswer: true } : {}),
  ...(input.questionMessageId
    ? { questionMessageId: input.questionMessageId }
    : {}),
});
