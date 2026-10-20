import { homedir } from "node:os";
import { z } from "zod";
import type {
  OpenCodeAuthMethod,
  OpenCodeAuthProvider,
  OpenCodeAuthRequest,
  OpenCodeAuthResult,
} from "../../../shared/opencode-auth";
import { openCodeNativeApi } from "./native-api";

const field = z.object({
  key: z.string(),
  type: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  hidden: z.boolean().optional(),
  default: z.unknown().optional(),
  options: z
    .array(z.object({ value: z.string(), label: z.string() }))
    .optional(),
  when: z.unknown().optional(),
});
const providers = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      metadata: z.object({ source: z.string().optional() }).optional(),
      connections: z.array(z.unknown()),
      methods: z.array(
        z.object({
          type: z.string(),
          id: z.string().optional(),
          label: z.string().optional(),
          form: z.array(field).optional(),
        }),
      ),
    }),
  ),
});
const attempt = z.object({
  data: z.object({
    attemptID: z.string(),
    url: z
      .url()
      .refine((url) => ["https:", "http:"].includes(new URL(url).protocol)),
    instructions: z.string(),
    mode: z.enum(["auto", "code"]),
    time: z.object({ expires: z.number() }),
  }),
});
const status = z.object({
  data: z.discriminatedUnion("status", [
    z.object({ status: z.literal("pending") }),
    z.object({ status: z.literal("complete") }),
    z.object({ status: z.literal("expired") }),
    z.object({ status: z.literal("failed"), message: z.string() }),
  ]),
});

const at = (path: string, directory = homedir()) =>
  `${path}?${new URLSearchParams({ "location[directory]": directory })}`;

export async function openCodeAuthProviders(
  directory?: string,
): Promise<OpenCodeAuthProvider[]> {
  const list = providers.parse(
    await openCodeNativeApi("GET", at("/api/integration", directory)),
  ).data;
  return list
    .filter((p) => p.metadata?.source !== "mcp")
    .map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connections.length > 0,
      methods: p.methods.flatMap<OpenCodeAuthMethod>((method) => {
        if (method.type !== "oauth" && method.type !== "key") return [];
        const fields = method.form ?? [];
        return [
          {
            id: method.id ?? "key",
            type: method.type,
            label: method.label ?? "API key",
            fields: fields.map((f) => ({
              ...f,
              title: f.title ?? f.key,
              default: typeof f.default === "string" ? f.default : undefined,
            })),
            ...(fields.some((f) => f.type !== "string" || f.when !== undefined)
              ? {
                  unavailable:
                    "This method needs an authentication form Relay doesn't support yet.",
                }
              : {}),
          },
        ];
      }),
    }))
    .filter((p) => p.methods.length > 0);
}

export async function openCodeAuth(
  input: OpenCodeAuthRequest,
): Promise<OpenCodeAuthResult> {
  const base = `/api/integration/${encodeURIComponent(input.provider)}/connect`;
  if (input.kind === "key") {
    await openCodeNativeApi("POST", at(`${base}/key`, input.directory), {
      key: input.key,
      answer: input.answer,
    });
    return { kind: "done" };
  }
  if (input.kind === "oauth") {
    const found = attempt.parse(
      await openCodeNativeApi("POST", at(`${base}/oauth`, input.directory), {
        methodID: input.method,
        answer: input.answer,
      }),
    ).data;
    return {
      kind: "attempt",
      attempt: {
        attemptID: found.attemptID,
        url: found.url,
        instructions: found.instructions,
        mode: found.mode,
        expires: found.time.expires,
      },
    };
  }
  const path = `${base}/oauth/${encodeURIComponent(input.attempt)}`;
  if (input.kind === "status")
    return {
      kind: "status",
      state: status.parse(
        await openCodeNativeApi("GET", at(path, input.directory)),
      ).data,
    };
  if (input.kind === "cancel")
    await openCodeNativeApi("DELETE", at(path, input.directory));
  else
    await openCodeNativeApi("POST", at(`${path}/complete`, input.directory), {
      code: input.code,
    });
  return { kind: "done" };
}
