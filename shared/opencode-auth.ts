import { z } from "zod";

export const openCodeAuthId = z.string().min(1).max(300);
export const openCodeAuthDirectory = z.string().min(1).max(4096).optional();
export const openCodeAuthAnswer = z.record(
  z.string().max(200),
  z.string().max(4096),
);
export interface OpenCodeAuthField {
  key: string;
  title: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  default?: string;
  options?: { value: string; label: string }[];
}
export interface OpenCodeAuthMethod {
  id: string;
  type: "oauth" | "key";
  label: string;
  fields: OpenCodeAuthField[];
  unavailable?: string;
}
export interface OpenCodeAuthProvider {
  id: string;
  name: string;
  connected: boolean;
  methods: OpenCodeAuthMethod[];
}
export interface OpenCodeAuthAttempt {
  attemptID: string;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  expires: number;
}
export type OpenCodeAuthStatus =
  | { status: "pending" | "complete" | "expired" }
  | { status: "failed"; message: string };

const target = { provider: openCodeAuthId, directory: openCodeAuthDirectory };
export const openCodeAuthRequest = z.discriminatedUnion("kind", [
  z.object({
    ...target,
    kind: z.literal("oauth"),
    method: openCodeAuthId,
    answer: openCodeAuthAnswer,
  }),
  z.object({
    ...target,
    kind: z.literal("key"),
    key: z.string().trim().min(1).max(16384),
    answer: openCodeAuthAnswer,
  }),
  z.object({ ...target, kind: z.literal("status"), attempt: openCodeAuthId }),
  z.object({ ...target, kind: z.literal("cancel"), attempt: openCodeAuthId }),
  z.object({
    ...target,
    kind: z.literal("complete"),
    attempt: openCodeAuthId,
    code: z.string().trim().min(1).max(16384),
  }),
]);
export type OpenCodeAuthRequest = z.infer<typeof openCodeAuthRequest>;
export type OpenCodeAuthResult =
  | { kind: "attempt"; attempt: OpenCodeAuthAttempt }
  | { kind: "status"; state: OpenCodeAuthStatus }
  | { kind: "done" };
