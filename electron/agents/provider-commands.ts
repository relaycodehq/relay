import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { memoByKey, memoWhileStamp } from "../util/memo";
import { terminate } from "../platform/terminate";
import { findExecutable, installStamp, spawnExecutable } from "../platform/executables";
import {
  withCodexTransport,
  type CodexTransport,
} from "../rooms/codex-transport";
import {
  modelSchema,
  reasoningEffortSchema,
  type CodexModel,
} from "../../shared/settings";
import type { CodexDefaults } from "../../shared/agent-defaults";
const skillSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_.:-]+$/),
  path: z.string().refine(isAbsolute),
  enabled: z.boolean().optional(),
  scope: z.string().nullable().optional(),
  interface: z
    .object({
      displayName: z.string().nullable().optional(),
      shortDescription: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  description: z.string().optional(),
  shortDescription: z.string().nullable().optional(),
});
export type CodexSkill = z.infer<typeof skillSchema>;
/** Codex's skills for a checkout, remembered for a minute. */
export const codexSkills = memoByKey((root) => discover(root));
function discover(root: string): Promise<CodexSkill[]> {
  return withAppServer(root, "loading skills", async (wire) => {
    const response = await wire.request("skills/list", { cwds: [root] });
    const entries = z
      .object({
        data: z
          .array(
            z.object({
              cwd: z.string(),
              skills: z.array(z.unknown()).max(5000),
            }),
          )
          .max(100),
      })
      .parse(response).data;
    return (entries.find((e) => e.cwd === root)?.skills ?? []).flatMap(
      (value) => {
        const parsed = skillSchema.safeParse(value);
        return parsed.success && parsed.data.enabled !== false
          ? [parsed.data]
          : [];
      },
    );
  });
}
const modelEntrySchema = z.object({
  id: z.string(),
  model: z.string().optional(),
  displayName: z.string().nullish(),
  description: z.string().nullish(),
  hidden: z.boolean().nullish(),
  upgrade: z.unknown().optional(),
  supportedReasoningEfforts: z
    .array(z.object({ reasoningEffort: z.string() }))
    .max(20)
    .nullish(),
  defaultReasoningEffort: z.string().nullish(),
  isDefault: z.boolean().nullish(),
});
const modelPageSchema = z.object({
  data: z.array(z.unknown()).max(500),
  nextCursor: z.string().nullish(),
});
/**
 * Asks the installed CLI which models this account can use, again once it's
 * updated: a new version brings new models.
 */
export const codexModels = memoWhileStamp(
  () => findExecutable("codex").then(installStamp),
  (): Promise<CodexModel[]> =>
    withAppServer(homedir(), "listing models", async (wire) => {
      // Signed out, Codex still lists the few models built into it. Kept, that
      // list would outlast signing in; failing lets the picker ask again.
      const { account, requiresOpenaiAuth } = await wire.request(
        "account/read",
        {},
      );
      if (!account && requiresOpenaiAuth)
        throw new Error("Sign in to Codex to list its models.");
      const models: CodexModel[] = [];
      let cursor: string | null | undefined;
      for (let page = 0; page < 10; page++) {
        const response = modelPageSchema.parse(
          await wire.request("model/list", cursor ? { cursor } : {}),
        );
        for (const value of response.data) {
          const entry = modelEntrySchema.safeParse(value).data;
          const id = modelSchema.safeParse(entry?.model ?? entry?.id).data;
          if (!entry || !id || entry.hidden) continue;
          const defaultEffort = reasoningEffortSchema.safeParse(
            entry.defaultReasoningEffort,
          ).data;
          models.push({
            id,
            name: entry.displayName || id,
            description: entry.description ?? "",
            efforts: (entry.supportedReasoningEfforts ?? []).flatMap(
              ({ reasoningEffort }) => {
                const effort = reasoningEffortSchema.safeParse(reasoningEffort);
                return effort.success && effort.data ? [effort.data] : [];
              },
            ),
            legacy: entry.upgrade != null,
            ...(defaultEffort ? { defaultEffort } : {}),
            ...(entry.isDefault ? { isDefault: true } : {}),
          });
        }
        cursor = response.nextCursor;
        if (!cursor) break;
      }
      return models;
    }),
);
const configSchema = z.object({
  config: z.object({
    model: z.string().nullish(),
    model_reasoning_effort: z.string().nullish(),
  }),
});
/** The model and effort Codex's config gives threads in `root` that leave them on Default. */
export const codexDefaults = memoByKey<CodexDefaults>((cwd) =>
  withAppServer(cwd, "reading its config", async (wire) => {
    const { config } = configSchema.parse(
      await wire.request("config/read", { cwd }),
    );
    return {
      model: modelSchema.safeParse(config.model).data ?? "",
      effort:
        reasoningEffortSchema.safeParse(config.model_reasoning_effort).data ??
        "",
    };
  }),
);
/** Runs one exchange with a short-lived `codex app-server`. */
async function withAppServer<T>(
  cwd: string,
  task: string,
  run: (wire: CodexTransport) => Promise<T>,
): Promise<T> {
  const child = spawnExecutable(await findExecutable("codex"), ["app-server"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  let fail!: (e: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  void failed.catch(() => {});
  child.on("error", fail);
  child.on("close", () => fail(new Error(`Codex stopped while ${task}.`)));
  const timer = setTimeout(
    () => fail(new Error(`Codex timed out while ${task}.`)),
    12000,
  );
  try {
    return await Promise.race([
      failed,
      withCodexTransport(
        child,
        () => {},
        fail,
        async (wire) => {
          await wire.request("initialize", {
            clientInfo: {
              name: "relay",
              title: "Relay",
              version: "0.1.0",
            },
            capabilities: { experimentalApi: true },
          });
          await wire.notify("initialized");
          return run(wire);
        },
      ),
    ]);
  } finally {
    clearTimeout(timer);
    child.stdin.end();
    terminate(child, { graceMs: 1500 });
  }
}
