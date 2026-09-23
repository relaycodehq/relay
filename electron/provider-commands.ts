import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { findExecutable, spawnExecutable } from "./executables";
import {
  withCodexTransport,
  type CodexTransport,
} from "./rooms/codex-transport";
import {
  modelSchema,
  reasoningEffortSchema,
  type CodexModel,
} from "../shared/settings";
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
const cache = new Map<
  string,
  { expires: number; result: Promise<CodexSkill[]> }
>();
export function codexSkills(root: string): Promise<CodexSkill[]> {
  const previous = cache.get(root);
  if (previous && previous.expires > Date.now()) return previous.result;
  const result = discover(root).catch((e) => {
    cache.delete(root);
    throw e;
  });
  if (cache.size >= 30) cache.delete(cache.keys().next().value!);
  cache.set(root, { expires: Date.now() + 60000, result });
  return result;
}
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
});
const modelPageSchema = z.object({
  data: z.array(z.unknown()).max(500),
  nextCursor: z.string().nullish(),
});
let modelList: Promise<CodexModel[]> | undefined;
/** Asks the installed CLI which models this account can use, once per launch. */
export function codexModels(): Promise<CodexModel[]> {
  modelList ??= withAppServer(homedir(), "listing models", async (wire) => {
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
        });
      }
      cursor = response.nextCursor;
      if (!cursor) break;
    }
    return models;
  }).catch((e) => {
    // Let the next caller ask again, e.g. after signing in.
    modelList = undefined;
    throw e;
  });
  return modelList;
}
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
              name: "review_relay",
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
    child.kill("SIGTERM");
    const kill = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 1500);
    kill.unref();
    child.once("exit", () => clearTimeout(kill));
  }
}
