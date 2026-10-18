import { parseVersion } from "../../../shared/agent-updates";
import {
  findExecutable,
  installStamp,
  runExecutable,
} from "../../platform/executables";
import { memoByKey } from "../../util/memo";
import type { AgentRuntime } from "../types";

/** The major version an install says it is; 1 when it won't say. */
const majorOf = memoByKey(
  async (stamp) => {
    const run = await runExecutable(
      stamp.split("\0")[0],
      ["--version"],
      10_000,
    );
    const major = Number(parseVersion(run.stdout)?.split(".")[0]);
    return major >= 2 ? 2 : 1;
  },
  { ttl: 10 * 60_000, max: 4 },
);

/**
 * Which OpenCode is installed. 2 rewrote it: its server has another API and
 * Relay reaches it over ACP instead. Not installed counts as 1, whose
 * runtime says so in its own words.
 */
export async function openCodeGeneration(): Promise<1 | 2> {
  try {
    const found = await findExecutable("opencode");
    return await majorOf(await installStamp(found));
  } catch {
    return 1;
  }
}

/**
 * One runtime for both OpenCodes, asking which is installed on every call so
 * an upgrade takes effect without restarting Relay. Closing, disposing and
 * reattaching go to both: each only finds its own sessions.
 */
export function byGeneration(v1: AgentRuntime, v2: AgentRuntime): AgentRuntime {
  const pick = async () => ((await openCodeGeneration()) === 2 ? v2 : v1);
  return {
    run: async (options) => (await pick()).run(options),
    closeSession: async (key) => {
      await Promise.all([v1.closeSession(key), v2.closeSession(key)]);
    },
    // OpenCode 1's own record; empty for a thread on 2.
    subagents: (key) => v1.subagents?.(key),
    models: async () => (await pick()).models(),
    reloadModels: async (beforeRestart) =>
      (await pick()).reloadModels?.(beforeRestart),
    defaults: async (root) => (await pick()).defaults(root),
    commands: async (root) => (await pick()).commands(root),
    knownCommands: async (root) => (await pick()).knownCommands?.(root),
    dispose: async () => {
      await Promise.all([v1.dispose?.(), v2.dispose?.()]);
    },
    detach: () => {
      v1.detach?.();
      v2.detach?.();
    },
    reattach: async (owns, unprompted) =>
      (
        await Promise.all([
          v1.reattach?.(owns, unprompted) ?? [],
          v2.reattach?.(owns, unprompted) ?? [],
        ])
      ).flat(),
  };
}
