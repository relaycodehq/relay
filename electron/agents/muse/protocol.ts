import { z } from "zod";

/**
 * The parts of the Muse Session Protocol (MSP, `muse serve`) Relay reads.
 * Lenient on purpose: MSP grows by adding fields and enum values, and a
 * value Relay doesn't know is shown generically, never refused.
 */

/** Relay's name on the wire; MSP wants a machine identifier. */
export const CLIENT_INFO = { name: "relay", version: "1.0.0" } as const;

/** An idempotency handle MSP requires on every command: a UUIDv7. */
export function commandId(now = Date.now()) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type MuseEffort = (typeof efforts)[number];
export const isEffort = (value: unknown): value is MuseEffort =>
  efforts.includes(value as MuseEffort);

/** Muse's permission profiles, as `permissionProfile/list` names them. */
export const profiles = {
  readOnly: ":read-only",
  askMe: ":ask-me",
  autoReview: ":auto-review",
  unrestricted: ":unrestricted",
} as const;

export const initializeResultSchema = z
  .object({
    serverInfo: z.object({ name: z.string(), version: z.string() }).loose(),
    grantedCapabilities: z.array(z.string()).default([]),
    experimentalApi: z.boolean().default(false),
    sessionDurability: z.string().optional(),
  })
  .loose();

export const sessionSchema = z
  .object({
    sessionId: z.string(),
    status: z.string().optional(),
    activeTurnId: z.string().nullable().optional(),
    modelId: z.string().nullable().optional(),
    title: z.string().optional(),
    name: z.string().optional(),
  })
  .loose();

/** What `session/start`, `session/resume` and `session/fork` answer. */
export const openedSchema = z
  .object({
    session: sessionSchema,
    viewCursor: z.string().optional(),
    lastTurn: z
      .object({ turnId: z.string(), terminal: z.string() })
      .loose()
      .optional(),
  })
  .loose();

export const turnStartResultSchema = z
  .object({
    turnId: z.string(),
    disposition: z.string().optional(),
    startedNewTurn: z.boolean().optional(),
  })
  .loose();

const tokenUsageSchema = z
  .object({
    inputTokens: z.number().default(0),
    outputTokens: z.number().default(0),
    cachedTokens: z.number().default(0),
    reasoningTokens: z.number().default(0),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
  })
  .loose();
export type MuseTokenUsage = z.infer<typeof tokenUsageSchema>;

const outputRefSchema = z.object({ id: z.string() }).loose();

export const itemSchema = z
  .object({
    itemId: z.string(),
    kind: z.string(),
    status: z.string(),
    turnId: z.string().nullable().optional(),
    revision: z.number().optional(),
    text: z.string().optional(),
    summary: z.array(z.string()).optional(),
    tool: z.string().optional(),
    args: z.string().optional(),
    visibleOutput: z.string().optional(),
    outputRef: outputRefSchema.optional(),
    patchRef: outputRefSchema.optional(),
    patchSummary: z
      .object({ added: z.number(), removed: z.number(), files: z.number() })
      .loose()
      .optional(),
    statusLine: z.string().optional(),
    failureReason: z.string().optional(),
    fallbackText: z.string().optional(),
    commandId: z.string().optional(),
    steered: z.boolean().optional(),
    cutOff: z.boolean().optional(),
    // `subagent`
    subagentId: z.string().optional(),
    childSessionId: z.string().optional(),
    objective: z.string().optional(),
    role: z.string().optional(),
    agentPath: z.string().optional(),
    result: z
      .object({ summary: z.string().optional(), text: z.string().optional() })
      .loose()
      .optional(),
    usage: tokenUsageSchema.optional(),
    // `compaction`
    tokensBefore: z.number().optional(),
    tokensAfter: z.number().optional(),
    reason: z.string().optional(),
    // `reminderChild`: Muse's own checks around a turn, never shown.
    reminderAgentId: z.string().optional(),
  })
  .loose();
export type MuseItem = z.infer<typeof itemSchema>;

const choiceSchema = z
  .object({
    choiceId: z.string(),
    decision: z.string(),
    label: z.string().optional(),
    scope: z.string().optional(),
    rulePreview: z.string().optional(),
  })
  .loose();
export type MuseChoice = z.infer<typeof choiceSchema>;

const subjectSchema = z
  .object({
    kind: z.string(),
    command: z.string().optional(),
    path: z.string().optional(),
    access: z.string().optional(),
    host: z.string().optional(),
    port: z.number().optional(),
    protocol: z.string().optional(),
    target: z.string().optional(),
    toolName: z.string().optional(),
  })
  .loose();

const requirementSchema = z
  .object({ approvalId: z.string(), sourceIndex: z.number() })
  .loose();

export const approvalRequestSchema = z
  .object({
    approvalId: z.string(),
    sessionId: z.string(),
    turnId: z.string().optional(),
    itemId: z.string().optional(),
    toolName: z.string().optional(),
    rawArgs: z.string().optional(),
    availableChoices: z.array(choiceSchema),
    currentRequirementId: requirementSchema,
    subject: subjectSchema,
    subagentOrigin: z.object({ subagentId: z.string() }).loose().optional(),
  })
  .loose();
export type MuseApproval = z.infer<typeof approvalRequestSchema>;

/** A later stage of an approval: new choices for the same approval. */
export const approvalUpdatedSchema = approvalRequestSchema
  .pick({
    approvalId: true,
    sessionId: true,
    availableChoices: true,
    currentRequirementId: true,
    subject: true,
  })
  .loose();

export const userInputRequestSchema = z
  .object({
    userInputId: z.string(),
    sessionId: z.string(),
    turnId: z.string().optional(),
    questions: z.array(
      z
        .object({
          id: z.string(),
          header: z.string().optional(),
          question: z.string(),
          options: z
            .array(z.object({ label: z.string(), description: z.string().optional() }).loose())
            .default([]),
          selection: z.object({ mode: z.string() }).loose().optional(),
        })
        .loose(),
    ),
  })
  .loose();
export type MuseUserInput = z.infer<typeof userInputRequestSchema>;

export const turnCompletedSchema = z
  .object({
    sessionId: z.string(),
    turnId: z.string(),
    terminal: z.string(),
    reason: z.string().optional(),
    error: z
      .object({
        kind: z.string(),
        message: z.string(),
        retryable: z.boolean().optional(),
        quota: z
          .object({ limitKind: z.string().optional(), resetsAtMs: z.number() })
          .loose()
          .optional(),
      })
      .loose()
      .optional(),
    usage: tokenUsageSchema.optional(),
  })
  .loose();
export type MuseTurnCompleted = z.infer<typeof turnCompletedSchema>;

export const tokenUsageNoticeSchema = z
  .object({
    turnId: z.string().optional(),
    modelId: z.string().nullable().optional(),
    usage: tokenUsageSchema,
    durationMs: z.number().optional(),
  })
  .loose();

export const contextUsageSchema = z
  .object({ usedTokens: z.number(), windowTokens: z.number().optional() })
  .loose();

export const todoListSchema = z
  .object({
    items: z.array(z.object({ text: z.string(), status: z.string() }).loose()),
  })
  .loose();

export const goalSchema = z
  .object({
    objective: z.string(),
    status: z.string(),
    percentComplete: z.number().optional(),
  })
  .loose();
export type MuseGoal = z.infer<typeof goalSchema>;

export const subscriptionUsageSchema = z
  .object({
    tier: z.string().optional(),
    window: z
      .object({
        usedPercent: z.number(),
        resetsAtMs: z.number(),
        windowDurationMins: z.number().optional(),
      })
      .loose(),
    weekly: z
      .object({ usedPercent: z.number(), resetsAtMs: z.number() })
      .loose()
      .optional(),
  })
  .loose();
export type MuseSubscriptionUsage = z.infer<typeof subscriptionUsageSchema>;

export const modelListSchema = z
  .object({
    models: z.array(
      z
        .object({
          modelId: z.string(),
          displayLabel: z.string().optional(),
          description: z.string().nullable().optional(),
          isDefault: z.boolean().optional(),
          contextLimit: z.number().nullable().optional(),
          defaultReasoningEffort: z.string().optional(),
          // An array of efforts, or an object saying they are unknown.
          variants: z.unknown().optional(),
        })
        .loose(),
    ),
  })
  .loose();
export type MuseModel = z.infer<typeof modelListSchema>["models"][number];

export const skillListSchema = z
  .object({
    skills: z.array(
      z
        .object({
          selector: z.string(),
          displayName: z.string().optional(),
          description: z.string().optional(),
          argumentHint: z.string().optional(),
        })
        .loose(),
    ),
  })
  .loose();

export const accountSchema = z
  .object({
    state: z.string(),
    credentialRequired: z.boolean().optional(),
    label: z.string().optional(),
  })
  .loose();

export const loginStartSchema = z
  .object({ verificationUrl: z.string().optional(), userCode: z.string().optional() })
  .loose();

/** MSP's typed errors Relay acts on; see the error table `muse schema` exports. */
export const errorKinds = {
  authRequired: "authRequired",
  commandRejected: "commandRejected",
} as const;
