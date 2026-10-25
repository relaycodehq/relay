import {
  UnavailableError,
  type Installed,
  type Progress,
  type ServerInstaller,
} from "./install";
import type { ServerSpec } from "./registry";

/** What to run to start a server, and where it came from. */
export interface Launch {
  command: string;
  args: string[];
  env?: Record<string, string>;
  source: "path" | "installed" | "downloaded";
  version?: string;
}

export type Resolution =
  | { launch: Launch }
  /** Not on PATH and Relay can't fetch it; the message says what to install. */
  | { missing: string };

export interface ResolveDeps {
  /** A program on PATH or in the usual install folders. */
  find(name: string): Promise<string | undefined>;
  probe(file: string, args: string[]): Promise<boolean>;
  installer: Pick<ServerInstaller, "installed" | "ensure">;
  /** The command line for a found path: scripts need their interpreter. */
  command(file: string, args: string[]): { command: string; args: string[] };
  /** A JavaScript runtime that doesn't depend on what the user installed. */
  node: { command: string; env: Record<string, string> };
}

/**
 * Zed's order: a server the user has wins, then one Relay already fetched,
 * then fetch it. Rejects when fetching fails.
 */
export async function resolveServer(
  spec: ServerSpec,
  deps: ResolveDeps,
  hooks: { downloading?: () => void; progress?: Progress } = {},
): Promise<Resolution> {
  for (const name of spec.commands) {
    const found = await deps.find(name).catch(() => undefined);
    if (!found) continue;
    if (spec.probe && !(await deps.probe(found, spec.probe))) continue;
    const line = deps.command(found, spec.args);
    return { launch: { ...line, source: "path" } };
  }
  const have = await deps.installer.installed(spec);
  if (have) return { launch: launchOf(spec, deps, have, "installed") };
  if (!spec.github && !spec.npm) return { missing: spec.hint };
  hooks.downloading?.();
  try {
    const fresh = await deps.installer.ensure(spec, hooks.progress);
    return { launch: launchOf(spec, deps, fresh, "downloaded") };
  } catch (e) {
    if (e instanceof UnavailableError) return { missing: e.message };
    throw e;
  }
}

function launchOf(
  spec: ServerSpec,
  deps: ResolveDeps,
  installed: Installed,
  source: Launch["source"],
): Launch {
  const base = installed.node
    ? {
        command: deps.node.command,
        args: [installed.exe, ...spec.args],
        env: deps.node.env,
      }
    : { command: installed.exe, args: spec.args };
  return { ...base, source, version: installed.version };
}
