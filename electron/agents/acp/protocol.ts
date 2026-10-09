// The part of the Agent Client Protocol (https://agentclientprotocol.com,
// version 1) Relay speaks. Agents add fields and update kinds as the spec
// grows, so every schema here lets through what it doesn't know, and a field
// in a shape Relay can't use reads as absent.
import { z } from "zod";
import { lenient } from "../schema-kit";

export const ACP_VERSION = 1;

const text = lenient(z.string());

const authMethodSchema = z
  .object({
    id: z.string(),
    name: text,
    description: text,
    /** Left out or `agent`: the agent signs in itself. `terminal`/`env_var` need the user. */
    type: text,
  })
  .loose();

export const initializeResultSchema = z
  .object({
    protocolVersion: z.number(),
    agentCapabilities: lenient(
      z
        .object({
          loadSession: lenient(z.boolean()),
          promptCapabilities: lenient(
            z
              .object({
                image: lenient(z.boolean()),
                embeddedContext: lenient(z.boolean()),
              })
              .loose(),
          ),
          mcpCapabilities: lenient(
            z.object({ http: lenient(z.boolean()) }).loose(),
          ),
          sessionCapabilities: lenient(
            z.object({ resume: lenient(z.unknown()) }).loose(),
          ),
          auth: lenient(z.object({ logout: lenient(z.unknown()) }).loose()),
        })
        .loose(),
    ),
    authMethods: lenient(z.array(authMethodSchema)),
    agentInfo: lenient(
      z.object({ name: text, title: text, version: text }).loose(),
    ),
  })
  .loose();
export type AcpInitialized = z.infer<typeof initializeResultSchema>;

const optionSchema = z
  .object({ value: z.string(), name: text, description: text })
  .loose();
/** A select's options, flat or in groups. */
const optionsSchema = z
  .array(
    z.union([
      optionSchema,
      z
        .object({ group: text, name: text, options: z.array(optionSchema) })
        .loose(),
    ]),
  )
  .catch([]);

export const configOptionSchema = z
  .object({
    id: z.string(),
    name: text,
    description: text,
    /** `mode`, `model`, `thought_level`, or the agent's own. */
    category: text,
    type: text,
    currentValue: lenient(z.union([z.string(), z.boolean()])),
    options: optionsSchema.optional(),
  })
  .loose();
export type AcpConfigOption = z.infer<typeof configOptionSchema>;
export type AcpChoice = { value: string; name: string; description?: string };

/** A select's options as one list, each named. */
export function choicesOf(option: AcpConfigOption): AcpChoice[] {
  return (option.options ?? []).flatMap((entry) =>
    ("options" in entry && Array.isArray(entry.options)
      ? (entry.options as z.infer<typeof optionSchema>[])
      : [entry as z.infer<typeof optionSchema>]
    ).map((o) => ({
      value: o.value,
      name: o.name || o.value,
      ...(o.description ? { description: o.description } : {}),
    })),
  );
}

const modesSchema = z
  .object({
    currentModeId: text,
    availableModes: z
      .array(z.object({ id: z.string(), name: text, description: text }).loose())
      .catch([]),
  })
  .loose();

/** The model list agents sent before config options; some still do. */
const modelsSchema = z
  .object({
    currentModelId: text,
    availableModels: z
      .array(
        z
          .object({ modelId: z.string(), name: text, description: text })
          .loose(),
      )
      .catch([]),
  })
  .loose();

/** What `session/new`, `session/load` and `session/resume` answer. */
export const sessionResultSchema = z
  .object({
    sessionId: lenient(z.string()),
    configOptions: lenient(z.array(configOptionSchema)),
    modes: lenient(modesSchema),
    models: lenient(modelsSchema),
  })
  .loose();
export type AcpSessionState = z.infer<typeof sessionResultSchema>;

export const promptResultSchema = z
  .object({
    stopReason: z.string(),
    usage: lenient(
      z
        .object({
          inputTokens: lenient(z.number()),
          outputTokens: lenient(z.number()),
          cachedReadTokens: lenient(z.number()),
          cachedWriteTokens: lenient(z.number()),
          thoughtTokens: lenient(z.number()),
        })
        .loose(),
    ),
  })
  .loose();
export type AcpPromptResult = z.infer<typeof promptResultSchema>;

const contentBlockSchema = z
  .object({ type: z.string(), text: text, uri: text })
  .loose();

const toolContentSchema = z.array(
  z
    .object({
      type: z.string(),
      /** `content`: a content block. */
      content: lenient(contentBlockSchema),
      /** `diff`: a file's change. */
      path: text,
      oldText: text,
      newText: text,
    })
    .loose(),
);

const toolCallFields = {
  toolCallId: z.string(),
  title: text,
  kind: text,
  status: text,
  content: lenient(toolContentSchema),
  locations: lenient(
    z.array(z.object({ path: z.string(), line: lenient(z.number()) }).loose()),
  ),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
};
export const toolCallSchema = z.object(toolCallFields).loose();
export type AcpToolCall = z.infer<typeof toolCallSchema>;

export const updateSchema = z.discriminatedUnion("sessionUpdate", [
  z
    .object({
      sessionUpdate: z.enum([
        "agent_message_chunk",
        "agent_thought_chunk",
        "user_message_chunk",
      ]),
      content: contentBlockSchema,
    })
    .loose(),
  z
    .object({
      sessionUpdate: z.enum(["tool_call", "tool_call_update"]),
      ...toolCallFields,
    })
    .loose(),
  z
    .object({
      sessionUpdate: z.literal("plan"),
      entries: z
        .array(z.object({ content: z.string(), status: text }).loose())
        .catch([]),
    })
    .loose(),
  z
    .object({
      sessionUpdate: z.literal("available_commands_update"),
      availableCommands: z
        .array(
          z
            .object({
              name: z.string(),
              description: text,
              input: lenient(z.object({ hint: text }).loose()),
            })
            .loose(),
        )
        .catch([]),
    })
    .loose(),
  z
    .object({ sessionUpdate: z.literal("current_mode_update"), currentModeId: z.string() })
    .loose(),
  z
    .object({
      sessionUpdate: z.literal("config_option_update"),
      configOptions: z.array(configOptionSchema).catch([]),
    })
    .loose(),
  z
    .object({ sessionUpdate: z.literal("session_info_update"), title: text })
    .loose(),
  z
    .object({
      sessionUpdate: z.literal("usage_update"),
      used: z.number(),
      size: lenient(z.number()),
      cost: lenient(
        z.object({ amount: z.number(), currency: text }).loose(),
      ),
    })
    .loose(),
]);
export type AcpUpdate = z.infer<typeof updateSchema>;

/** A `session/update`'s update, or undefined for a kind this Relay doesn't know. */
export const parseUpdate = (raw: unknown): AcpUpdate | undefined =>
  updateSchema.safeParse(raw).data;

export const permissionRequestSchema = z
  .object({
    sessionId: z.string(),
    toolCall: z
      .object({
        toolCallId: lenient(z.string()),
        title: text,
        kind: text,
        content: lenient(toolContentSchema),
        locations: lenient(z.array(z.object({ path: z.string() }).loose())),
        rawInput: z.unknown().optional(),
      })
      .loose(),
    options: z.array(
      z.object({ optionId: z.string(), name: text, kind: z.string() }).loose(),
    ),
  })
  .loose();
export type AcpPermissionRequest = z.infer<typeof permissionRequestSchema>;

/** The answer to `session/request_permission`. */
export const picked = (optionId: string) => ({
  outcome: { outcome: "selected", optionId },
});
export const cancelledPermission = { outcome: { outcome: "cancelled" } };

/** JSON-RPC's code for a request that needs the user signed in first. */
export const AUTH_REQUIRED = -32000;
