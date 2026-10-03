import { z } from "zod";
import { lenient, named } from "../schema-kit";

/** OpenCode sent something Relay reads, without a field the turn can't go on without. */
export class OpenCodeShapeError extends Error {}

const text = lenient(z.string());
const flag = lenient(z.boolean());
const count = lenient(z.number());
const record = lenient(z.record(z.string(), z.unknown()));

/** Only the fields Relay reads are listed; whatever else OpenCode adds passes through. */
const failureSchema = z
  .object({
    name: text,
    data: lenient(
      z
        .object({
          message: text,
          providerID: text,
          statusCode: count,
          responseHeaders: lenient(z.record(z.string(), z.string())),
        })
        .loose(),
    ),
  })
  .loose();
/** A failure as OpenCode names it, or undefined for something that isn't one. */
export const readFailure = (value: unknown) =>
  failureSchema.safeParse(value).data;

const messageInfoSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    providerID: text,
    modelID: text,
    time: lenient(z.object({ created: count, completed: count }).loose()),
    // Whether it is one is up to `readFailure`: a message that failed must not pass as one that didn't.
    error: z.unknown().optional(),
  })
  .loose();

const partBaseSchema = z
  .object({ id: z.string(), messageID: z.string(), type: z.string() })
  .loose();
export type OpenCodePartBase = z.infer<typeof partBaseSchema>;

const tokensSchema = lenient(
  z
    .object({
      total: count,
      input: count,
      output: count,
      reasoning: count,
      cache: lenient(z.object({ read: count, write: count }).loose()),
    })
    .loose(),
);

/** A `tool` part of an OpenCode message, as `message.part.updated` carries it. */
const toolPartSchema = partBaseSchema.extend({
  type: z.literal("tool"),
  callID: z.string(),
  tool: z.string(),
  state: z
    .object({
      status: z.string(),
      input: record,
      output: text,
      error: text,
      title: text,
      metadata: record,
    })
    .loose(),
});
export type ToolPart = z.infer<typeof toolPartSchema>;

const partSchema = z.discriminatedUnion("type", [
  partBaseSchema.extend({
    type: z.enum(["text", "reasoning"]),
    text,
    synthetic: flag,
    ignored: flag,
  }),
  toolPartSchema,
  partBaseSchema.extend({
    type: z.literal("patch"),
    files: lenient(z.array(z.unknown())),
  }),
  partBaseSchema.extend({
    type: z.literal("step-finish"),
    cost: count,
    tokens: tokensSchema,
  }),
]);
export type OpenCodePart = z.infer<typeof partSchema>;
const detailed = new Set<string>(
  partSchema.options.flatMap((option) => {
    const type = option.shape.type;
    return "options" in type ? type.options : [type.value];
  }),
);

/**
 * The fields of a part Relay reads for its type, checked; undefined for a
 * type it doesn't read, which stays ignored.
 */
export function parseOpenCodePart(part: OpenCodePartBase) {
  if (!detailed.has(part.type)) return;
  const parsed = partSchema.safeParse(part);
  if (parsed.success) return parsed.data;
  throw new OpenCodeShapeError(
    `OpenCode sent an unexpected ${part.type} part (${named(parsed.error.issues[0]!)}).`,
  );
}

const event = <T extends string, S extends z.ZodRawShape>(
  type: T,
  properties: S,
) =>
  z.object({
    type: z.literal(type),
    properties: z.object(properties).loose(),
  });

/** What OpenCode asks before running a tool; see its `PermissionRequest`. */
const permissionRequest = {
  id: z.string(),
  sessionID: text,
  permission: z.string(),
  patterns: lenient(z.array(z.string())),
  metadata: record,
};
/** A question from OpenCode's `question` tool; see its `QuestionRequest`. */
const questionRequest = {
  id: z.string(),
  sessionID: text,
  questions: z.array(
    z
      .object({
        question: z.string(),
        header: text,
        options: z.array(
          z.object({ label: z.string(), description: text }).loose(),
        ),
        multiple: flag,
      })
      .loose(),
  ),
};
export const permissionRequestSchema = z.object(permissionRequest).loose();
export const questionRequestSchema = z.object(questionRequest).loose();
export type PermissionRequest = z.infer<typeof permissionRequestSchema>;
export type QuestionRequest = z.infer<typeof questionRequestSchema>;

const eventSchema = z.discriminatedUnion("type", [
  event("relay.stream.lost", { message: text }),
  event("session.status", {
    status: z
      .object({ type: z.string(), attempt: count, message: text })
      .loose(),
  }),
  event("session.idle", {}),
  event("session.error", { error: z.unknown().optional() }),
  event("message.updated", { info: messageInfoSchema }),
  event("message.part.updated", { part: partBaseSchema }),
  event("message.part.delta", {
    partID: z.string(),
    field: z.string(),
    delta: z.string(),
  }),
  event("permission.asked", permissionRequest),
  event("question.asked", questionRequest),
]);
export type ParsedOpenCodeEvent = z.infer<typeof eventSchema>;
const read = new Set<string>(
  eventSchema.options.map((option) => option.shape.type.value),
);

/**
 * An event Relay reads, checked; undefined for a type it doesn't, which stays
 * ignored. One it reads that arrives malformed throws.
 */
export function parseOpenCodeEvent(event: {
  type: string;
  properties: unknown;
}): ParsedOpenCodeEvent | undefined {
  if (!read.has(event.type)) return;
  const parsed = eventSchema.safeParse(event);
  if (parsed.success) return parsed.data;
  throw new OpenCodeShapeError(
    `OpenCode sent an unexpected ${event.type} event (${named(parsed.error.issues[0]!, 1)}).`,
  );
}

/** OpenCode's answer to a request for `what`, or an error naming what's wrong with it. */
export function parseOpenCodeResponse<T>(
  what: string,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new OpenCodeShapeError(
    `OpenCode sent an unexpected ${what} response (${named(parsed.error.issues[0]!)}).`,
  );
}

/** The session's messages, oldest first; a message's `parts` are its own. */
export const messageListSchema = z.array(
  z
    .object({
      info: messageInfoSchema,
      parts: z.array(partBaseSchema).nullish(),
    })
    .loose(),
);
export const sessionStatusSchema = z.record(
  z.string(),
  z.object({ type: z.string() }).loose(),
);
export const permissionListSchema = z.array(permissionRequestSchema);
export const questionListSchema = z.array(questionRequestSchema);
export const commandListSchema = z.array(
  z.object({ name: z.string() }).loose(),
);
/** Answers creating and forking a session. */
export const sessionCreatedSchema = z.object({ id: z.string() }).loose();
export const sessionSchema = z
  .object({
    model: lenient(z.object({ providerID: text, id: text }).loose()),
  })
  .loose();
