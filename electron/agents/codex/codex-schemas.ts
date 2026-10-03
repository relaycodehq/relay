import { z } from "zod";
import { lenient, named } from "../schema-kit";

/** Only the fields Relay reads are listed; whatever else Codex adds passes through. */
export const threadStartedSchema = z
  .object({
    thread: z.object({ id: z.string() }).loose(),
    model: lenient(z.string()),
    reasoningEffort: lenient(z.string()),
    activePermissionProfile: lenient(z.object({ id: z.string() }).loose()),
  })
  .loose();
export type CodexThreadStarted = z.infer<typeof threadStartedSchema>;

/** Answers `turn/start` and `review/start`. */
export const turnStartedSchema = z
  .object({ turn: z.object({ id: z.string() }).loose() })
  .loose();

export const configReadSchema = z
  .object({
    config: lenient(
      z
        .object({
          mcp_servers: lenient(z.record(z.string(), z.unknown())),
        })
        .loose(),
    ),
  })
  .loose();

const itemSchema = z
  .object({
    type: z.string(),
    id: lenient(z.string()),
    clientId: lenient(z.string()),
    phase: lenient(z.string()),
    text: lenient(z.string()),
    review: lenient(z.string()),
    changes: z.unknown().optional(),
  })
  .loose();

const scoped = { threadId: lenient(z.string()) };
const notification = <M extends string, S extends z.ZodRawShape>(
  method: M,
  params: S,
) =>
  z.object({
    method: z.literal(method),
    params: z.object({ ...scoped, ...params }).loose(),
  });

const notificationSchema = z.discriminatedUnion("method", [
  notification("account/rateLimits/updated", {
    rateLimits: z.unknown().optional(),
  }),
  notification("thread/tokenUsage/updated", {
    tokenUsage: z.unknown().optional(),
  }),
  notification("thread/name/updated", { threadName: lenient(z.string()) }),
  notification("item/started", { item: itemSchema }),
  notification("item/completed", { item: itemSchema }),
  notification("item/plan/delta", { delta: z.string() }),
  notification("item/agentMessage/delta", {
    delta: z.string(),
    itemId: lenient(z.string()),
  }),
  notification("turn/started", { turn: z.object({ id: z.string() }).loose() }),
  notification("turn/completed", {
    turn: z
      .object({ status: z.string(), error: z.unknown().optional() })
      .loose(),
  }),
  notification("error", {
    error: z.unknown().optional(),
    willRetry: lenient(z.boolean()),
  }),
]);
export type CodexNotification = z.infer<typeof notificationSchema>;
const read = new Set<string>(
  notificationSchema.options.map((option) => option.shape.method.value),
);

/**
 * A notification Relay reads, checked; undefined for a method it doesn't, which
 * stays ignored. One it reads that arrives malformed throws.
 */
export function parseCodexNotification(
  method: string,
  params: unknown,
): CodexNotification | undefined {
  if (!read.has(method)) return;
  const parsed = notificationSchema.safeParse({ method, params });
  if (parsed.success) return parsed.data;
  throw new Error(
    `Codex sent an unexpected ${method} notification (${named(parsed.error.issues[0]!, 1)}).`,
  );
}

/** Codex's answer to `method`, or an error naming what's wrong with it. */
export function parseCodexResponse<T>(
  method: string,
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new Error(
    `Codex sent an unexpected ${method} response (${named(parsed.error.issues[0]!)}).`,
  );
}

/** What a thread's context window holds; `last` is the newest request's size. */
const tokenUsageSchema = z
  .object({
    last: lenient(z.object({ totalTokens: lenient(z.number()) }).loose()),
    total: lenient(z.object({ totalTokens: lenient(z.number()) }).loose()),
    modelContextWindow: lenient(z.number()),
  })
  .loose();
export const readTokenUsage = (value: unknown) =>
  tokenUsageSchema.safeParse(value).data;
