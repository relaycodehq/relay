import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { findExecutable } from "./executables";
import { withCodexTransport } from "./rooms/codex-transport";
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
async function discover(root: string): Promise<CodexSkill[]> {
  const child = spawn(await findExecutable("codex"), ["app-server"], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  let fail!: (e: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    fail = reject;
  });
  void failed.catch(() => {});
  child.on("error", fail);
  child.on("exit", () =>
    fail(new Error("Codex stopped while loading skills.")),
  );
  const timer = setTimeout(
    () => fail(new Error("Codex skill discovery timed out.")),
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
