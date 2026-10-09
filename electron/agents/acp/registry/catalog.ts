import { z } from "zod";
import { registryIdPattern } from "../../../../shared/agents";
import type { RegistryListing } from "../../../../shared/acp-registry";

/**
 * The ACP registry (agentclientprotocol.com): the agents that speak ACP and
 * where each one's build for every machine comes from.
 */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const registryUrl =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const envSchema = z.record(z.string(), z.string()).optional();
const binarySchema = z.object({
  archive: z.string(),
  cmd: z.string(),
  args: z.array(z.string()).optional(),
  env: envSchema,
  sha256: z.string().optional(),
});
const packageSchema = z.object({
  package: z.string(),
  args: z.array(z.string()).optional(),
  env: envSchema,
});
export const entrySchema = z.object({
  id: z.string().regex(registryIdPattern),
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(60),
  description: z.string().max(400).optional(),
  website: z.string().optional(),
  repository: z.string().optional(),
  authors: z.array(z.string()).optional(),
  license: z.string().optional(),
  distribution: z.object({
    binary: z.record(z.string(), binarySchema).optional(),
    npx: packageSchema.optional(),
    uvx: packageSchema.optional(),
  }),
});
export type RegistryEntry = z.infer<typeof entrySchema>;

/** What Relay gets and runs for one agent on one machine. */
export type AgentPlan = {
  id: string;
  version: string;
  args: string[];
  env: Record<string, string>;
} & (
  | {
      kind: "binary";
      archive: string;
      /** The file in the archive to run, relative to it. */
      cmd: string;
      sha256?: string;
    }
  | {
      kind: "npm" | "uv";
      /** The package's name, without its version. */
      name: string;
    }
);

/** The registry's name for this machine, e.g. `darwin-aarch64`. */
export function registryTarget(platform: string, arch: string) {
  const os = platform === "win32" ? "windows" : platform;
  const cpu = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch;
  return `${os}-${cpu}`;
}
export const machineTarget = () =>
  registryTarget(process.platform, process.arch);

/** The registry's agents Relay can read; a malformed entry is left out, not fatal. */
export function entriesOf(registry: unknown): RegistryEntry[] {
  const agents = (registry as { agents?: unknown })?.agents;
  if (!Array.isArray(agents)) throw new Error("The ACP registry has no agents.");
  return agents.flatMap((raw) => {
    const entry = entrySchema.safeParse(raw).data;
    return entry ? [entry] : [];
  });
}

/**
 * A path inside the archive, as the registry writes it (`./bin/goose`,
 * `.\dist\agent.cmd`); undefined for anything that reaches out of it.
 */
export function archivePath(cmd: string) {
  const parts = cmd.replace(/\\/g, "/").replace(/^\.\//, "").split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    return undefined;
  if (/^[a-z]:$/i.test(parts[0])) return undefined;
  return parts.join("/");
}

/** `@scope/pkg@1.2.3` or `pkg==1.2.3` into its name and version. */
export function splitPackage(spec: string) {
  const match = /^(@?[^@=\s]+)(?:@|==)([^@=\s]+)$/.exec(spec);
  if (!match || !/^[\w@./-]+$/.test(match[1])) return undefined;
  return { name: match[1], version: match[2] };
}

/**
 * How Relay installs `entry` on `target`: its own download when there's one
 * for the machine, else npm, else uv. Throws on a build Relay won't run.
 */
export function planFor(entry: RegistryEntry, target: string): AgentPlan {
  const base = { id: entry.id, version: entry.version };
  const { binary, npx, uvx } = entry.distribution;
  const build = binary?.[target];
  if (build) {
    if (!build.archive.startsWith("https://"))
      throw new Error(`Refusing to download ${entry.name} from ${build.archive}.`);
    const cmd = archivePath(build.cmd);
    if (!cmd)
      throw new Error(
        `${entry.name}'s registry entry runs ${build.cmd}, which Relay won't run.`,
      );
    const sha256 = build.sha256?.toLowerCase();
    if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256))
      throw new Error(`${entry.name}'s registry entry has a malformed checksum.`);
    return {
      ...base,
      kind: "binary",
      archive: build.archive,
      cmd,
      ...(sha256 && { sha256 }),
      args: build.args ?? [],
      env: build.env ?? {},
    };
  }
  const pkg = npx ?? uvx;
  if (!pkg) throw new Error(`${entry.name} has no build for ${target}.`);
  const spec = splitPackage(pkg.package);
  if (!spec)
    throw new Error(`${entry.name}'s registry entry names a package Relay can't read.`);
  return {
    ...base,
    version: spec.version,
    kind: npx ? "npm" : "uv",
    name: spec.name,
    args: pkg.args ?? [],
    env: pkg.env ?? {},
  };
}

/**
 * Registry agents Settings doesn't offer: Relay's own, which it runs (and
 * installs when missing) itself, and Gemini CLI, whose Google sign-in is
 * closed to personal accounts and pops a browser on every start without one.
 */
const unlisted = new Set([
  "claude-acp",
  "codex-acp",
  "cursor",
  "opencode",
  "amp-acp",
  "antigravity-acp",
  "gemini",
]);
export const isListed = (entry: RegistryEntry) => !unlisted.has(entry.id);

/** `entry` as Settings lists it, without its icon. */
export function listingOf(entry: RegistryEntry, target: string): RegistryListing {
  let plan: AgentPlan | undefined;
  try {
    plan = planFor(entry, target);
  } catch {
    plan = undefined;
  }
  return {
    id: entry.id,
    name: entry.name,
    version: plan?.version ?? entry.version,
    description: entry.description ?? "",
    authors: entry.authors ?? [],
    ...(entry.license && { license: entry.license }),
    ...((entry.website ?? entry.repository)?.startsWith("https://") && {
      website: entry.website ?? entry.repository,
    }),
    ...(plan && {
      via: plan.kind === "binary" ? "download" : plan.kind,
      ...(plan.kind === "binary" && plan.sha256 && { verified: true }),
    }),
  };
}

const iconUrl = (id: string) =>
  `https://cdn.agentclientprotocol.com/registry/v1/latest/${id}.svg`;
const iconLimit = 32 * 1024;

/**
 * An agent's mark as a `data:` URI. It is drawn only as a CSS mask, where
 * an SVG can't run anything; the checks keep junk out of the settings file.
 */
export async function fetchIcon(fetch: Fetch, id: string) {
  try {
    const response = await fetch(iconUrl(id), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const svg = (await response.text()).trim();
    if (svg.length > iconLimit || !/^(<\?xml[^>]*>\s*)?<svg[\s>]/.test(svg))
      return undefined;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function fetchRegistry(fetch: Fetch) {
  const response = await fetch(registryUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`The ACP registry answered ${response.status}.`);
  return entriesOf(await response.json());
}
