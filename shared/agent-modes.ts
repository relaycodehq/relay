import { z } from "zod";
import type { AgentProvider } from "./agents";
// T3 Code runtimeModeConfig and CodexSessionRuntime (MIT); see THIRD_PARTY_NOTICES.
export const runtimeModeSchema = z.enum([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
export const interactionModeSchema = z.enum(["default", "plan"]);
export type InteractionMode = z.infer<typeof interactionModeSchema>;
export const runtimeModes = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    value: "auto",
    label: "Auto",
    description:
      "Supported providers approve routine actions; others still ask.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
] as const;
/**
 * What a mode means for an agent whose SDK can limit what it does but can't
 * stop to ask, where "Ask before commands" would be untrue.
 */
const limitedModes: Partial<
  Record<AgentProvider, Partial<Record<RuntimeMode, string>>>
> = {
  cursor: {
    "approval-required":
      "Cursor can't ask. Edits stay in the project, and its safety review blocks risky actions.",
    "auto-accept-edits":
      "Cursor can't ask. Edits stay in the project and MCP tools are off.",
    auto: "Cursor's safety review approves routine actions and blocks risky ones.",
  },
};
/** The modes as `provider` honors them: the same four, described truthfully. */
export const runtimeModesFor = (provider?: AgentProvider) =>
  runtimeModes.map((mode) => ({
    ...mode,
    description:
      (provider && limitedModes[provider]?.[mode.value]) || mode.description,
  }));
/** Upgrade persisted Relay choices without resetting them to T3's full-access default. */
export function savedRuntimeMode(value: unknown): RuntimeMode {
  if (value === "ask") return "approval-required";
  if (value === "edit") return "auto-accept-edits";
  return runtimeModeSchema.safeParse(value).data ?? "full-access";
}
export const decisionSchema = z.enum([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type AgentDecision = z.infer<typeof decisionSchema>;
export const agentResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("approval"), decision: decisionSchema }).strict(),
  z
    .object({
      kind: z.literal("question"),
      answers: z.record(
        z.string().max(200),
        z.array(z.string().max(16000)).max(30),
      ),
    })
    .strict(),
]);
export type AgentResponse = z.infer<typeof agentResponseSchema>;
export interface AgentQuestion {
  id: string;
  header?: string;
  question: string;
  isSecret?: boolean;
  multiple?: boolean;
  options?: { label: string; description?: string }[];
}
export interface AgentRequest {
  id: string;
  kind: "approval" | "question";
  title: string;
  detail?: string;
  decisions?: AgentDecision[];
  questions?: AgentQuestion[];
}
export type AskAgentRequest = (
  request: Omit<AgentRequest, "id">,
  signal?: AbortSignal,
) => Promise<AgentResponse>;
