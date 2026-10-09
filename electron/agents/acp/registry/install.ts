import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { RegistryVia } from "../../../../shared/acp-registry";
import { executableCommand, findExecutable } from "../../../platform/executables";
import { archivePath, type AgentPlan, type Fetch } from "./catalog";

/**
 * Puts a registry agent in a folder of its own: each version in
 * `<dir>/<version>`, and `current.json` naming the one Relay runs. The one
 * before stays, in case the new one turns out not to run.
 */
export interface InstalledAgent {
  version: string;
  via: RegistryVia;
  command: string;
  args: string[];
  env: Record<string, string>;
  name?: string;
  icon?: string;
}

const versionName = /^[\w.+-]+$/;
const pointerSchema = z.object({
  version: z.string().regex(versionName),
  /** Absent in what Antigravity's own installer wrote. */
  via: z.enum(["download", "npm", "uv"]).default("download"),
  cmd: z.string(),
  /** Started with Node rather than on its own. */
  node: z.boolean().optional(),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).default({}),
  name: z.string().optional(),
  icon: z.string().optional(),
});
type Pointer = z.input<typeof pointerSchema>;
const pointer = (dir: string) => join(dir, "current.json");

/** The version `dir` runs, if it's still all there. */
export async function installedIn(dir: string): Promise<InstalledAgent | undefined> {
  try {
    const found = pointerSchema.parse(
      JSON.parse(await readFile(pointer(dir), "utf8")),
    );
    const cmd = archivePath(found.cmd);
    if (!cmd) return undefined;
    const file = join(dir, found.version, cmd);
    await access(file);
    return {
      version: found.version,
      via: found.via,
      command: found.node ? "node" : file,
      args: found.node ? [file, ...found.args] : found.args,
      env: found.env,
      ...(found.name && { name: found.name }),
      ...(found.icon && { icon: found.icon }),
    };
  } catch {
    return undefined;
  }
}

type Run = (
  file: string,
  args: string[],
  options: { env?: Record<string, string>; cwd?: string },
) => Promise<void>;

/** What installing touches beyond the folder, so tests can stand in for it. */
export interface InstallIo {
  fetch: Fetch;
  /** Unpacks `file` into `out`; the tests' stand-in skips real archives. */
  extract?(file: string, out: string): Promise<void>;
  run?: Run;
  find?(name: string): Promise<string>;
  platform?: NodeJS.Platform;
}

type PackagePlan = Extract<AgentPlan, { name: string }>;

const installTimeout = 10 * 60_000;

const runProgram: Run = (file, args, { env, cwd }) =>
  new Promise((resolve, reject) => {
    const line = executableCommand(file, args);
    execFile(
      line.command,
      line.args,
      {
        cwd,
        env: { ...process.env, ...env },
        timeout: installTimeout,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) return resolve();
        const said = `${stderr}\n${stdout}`.trim().split("\n").slice(-12).join("\n");
        reject(new Error(said || error.message));
      },
    );
  });

const archiveKind = (url: string) => {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".zip")) return "zip";
  if (/\.(tar(\.(gz|bz2|xz|zst))?|tgz|tbz2?|txz)$/.test(path)) return "tar";
  return "file";
};

/** Unpacks with what every machine has. */
async function unpack(file: string, out: string, kind: "zip" | "tar") {
  await mkdir(out, { recursive: true });
  const windowsTar = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "tar.exe",
  );
  const [program, args] =
    kind === "tar"
      ? [
          process.platform === "win32"
            ? windowsTar
            : process.platform === "darwin"
              ? "/usr/bin/tar"
              : await findExecutable("tar"),
          ["-xf", file, "-C", out],
        ]
      : process.platform === "darwin"
        ? ["/usr/bin/ditto", ["-x", "-k", file, out]]
        : process.platform === "win32"
          ? [windowsTar, ["-xf", file, "-C", out]]
          : [
              await findExecutable("unzip").catch(() => {
                throw new Error("Unpacking it needs `unzip`. Install it, then try again.");
              }),
              ["-q", file, "-d", out],
            ];
  await runProgram(program, args, {});
}

async function sha256Of(file: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

/** Downloads and unpacks `plan` into `out`; returns the file to run, relative to `out`. */
async function getBinary(
  plan: Extract<AgentPlan, { kind: "binary" }>,
  staging: string,
  out: string,
  io: InstallIo,
) {
  const download = join(staging, "download");
  const response = await io.fetch(plan.archive);
  if (!response.ok || !response.body)
    throw new Error(`Downloading ${plan.id} failed (${response.status}).`);
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    createWriteStream(download),
  );
  if (plan.sha256 && (await sha256Of(download)) !== plan.sha256)
    throw new Error(
      `The ${plan.id} download doesn't match the checksum in the ACP registry; Relay threw it away.`,
    );
  const kind = archiveKind(plan.archive);
  if (kind === "file") {
    await mkdir(join(out, plan.cmd, ".."), { recursive: true });
    await copyFile(download, join(out, plan.cmd));
  } else if (io.extract) await io.extract(download, out);
  else await unpack(download, out, kind);
  const file = join(out, plan.cmd);
  await access(file).catch(() => {
    throw new Error(`The ${plan.id} download has no ${plan.cmd}.`);
  });
  // A link in the archive mustn't lead out of it.
  const real = await realpath(file);
  if (relative(await realpath(out), real).split(sep)[0] === "..")
    throw new Error(`The ${plan.id} download's ${plan.cmd} leads out of it.`);
  if ((io.platform ?? process.platform) !== "win32") await chmod(file, 0o755);
  return { cmd: plan.cmd };
}

/** The program a package's `bin` names: the one called like the package, or its only one. */
export function binOf(name: string, bin: unknown) {
  const short = name.replace(/^@[^/]+\//, "");
  if (typeof bin === "string") return bin;
  if (!bin || typeof bin !== "object") return undefined;
  const entries = Object.entries(bin as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return (
    entries.find(([key]) => key === short)?.[1] ??
    (entries.length === 1 ? entries[0][1] : undefined)
  );
}

/** Whether a package's program is JavaScript that Node starts. */
async function isNodeScript(file: string) {
  if (/\.[cm]?js$/i.test(file)) return true;
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(128), 0, 128, 0);
    return /^#!.*\bnode\b/.test(buffer.subarray(0, bytesRead).toString());
  } finally {
    await handle.close();
  }
}

/**
 * Installs the npm package into `out` with the user's own npm, so their
 * npm settings (registry, ignore-scripts, min-release-age) apply.
 */
async function getNpm(
  plan: PackagePlan,
  out: string,
  io: InstallIo,
) {
  const npm = await (io.find ?? findExecutable)("npm").catch(() => {
    throw new Error(`${plan.id} installs through npm. Install Node.js, then try again.`);
  });
  await mkdir(out, { recursive: true });
  await (io.run ?? runProgram)(
    npm,
    [
      "install",
      "--prefix",
      out,
      "--no-save",
      "--no-package-lock",
      "--no-audit",
      "--no-fund",
      `${plan.name}@${plan.version}`,
    ],
    {},
  );
  const home = join("node_modules", ...plan.name.split("/"));
  const manifest = JSON.parse(
    await readFile(join(out, home, "package.json"), "utf8"),
  );
  const bin = binOf(plan.name, manifest?.bin);
  const cmd = bin && archivePath(join(home, bin));
  if (!cmd) throw new Error(`${plan.name} has no program to run.`);
  return { cmd, node: await isNodeScript(join(out, cmd)) };
}

/** Installs the Python package into `out` with uv, in a tool folder of Relay's. */
async function getUv(
  plan: PackagePlan,
  out: string,
  io: InstallIo,
) {
  const uv = await (io.find ?? findExecutable)("uv").catch(() => {
    throw new Error(`${plan.id} installs through uv. Install uv (docs.astral.sh/uv), then try again.`);
  });
  await mkdir(out, { recursive: true });
  const run = io.run ?? runProgram;
  const install = (...extra: string[]) =>
    run(
      uv,
      ["tool", "install", "--force", ...extra, `${plan.name}==${plan.version}`],
      { env: { UV_TOOL_DIR: join(out, "tools"), UV_TOOL_BIN_DIR: join(out, "bin") } },
    );
  await install().catch((error: unknown) => {
    // Some agents pin a beta deep in their tree, which uv only takes when told to.
    if (!/pre-releases weren't enabled/.test(String(error))) throw error;
    return install("--prerelease=allow");
  });
  const exe = (io.platform ?? process.platform) === "win32" ? ".exe" : "";
  return { cmd: `bin/${plan.name}${exe}` };
}

const installing = new Map<string, Promise<InstalledAgent>>();

/**
 * Installs `plan` into `dir` and makes it the version Relay runs. Calls for
 * one folder share one install; a version already there isn't fetched again.
 */
export function installInto(
  dir: string,
  plan: AgentPlan,
  io: InstallIo,
  label: { name?: string; icon?: string } = {},
): Promise<InstalledAgent> {
  let run = installing.get(dir);
  if (!run) {
    run = install(dir, plan, io, label).finally(() => installing.delete(dir));
    installing.set(dir, run);
  }
  return run;
}

async function install(
  dir: string,
  plan: AgentPlan,
  io: InstallIo,
  label: { name?: string; icon?: string },
): Promise<InstalledAgent> {
  if (!versionName.test(plan.version))
    throw new Error(`${plan.id} ${plan.version} isn't a version Relay can keep.`);
  const previous = await installedIn(dir);
  const via: RegistryVia = plan.kind === "binary" ? "download" : plan.kind;
  const write = (found: Pointer) =>
    writeFile(pointer(dir), JSON.stringify({ ...found, ...label }));
  if (previous?.version === plan.version && previous.via === via) {
    const raw = JSON.parse(await readFile(pointer(dir), "utf8"));
    await write(raw);
    return (await installedIn(dir))!;
  }
  await mkdir(dir, { recursive: true });
  const target = join(dir, plan.version);
  let got: { cmd: string; node?: boolean };
  if (plan.kind === "binary") {
    const staging = join(dir, `.installing-${process.pid}-${Date.now()}`);
    try {
      await mkdir(staging);
      const out = join(staging, "out");
      got = await getBinary(plan, staging, out, io);
      await rm(target, { recursive: true, force: true });
      await rename(out, target);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } else {
    // Python environments don't survive a move, so packages install in place.
    await rm(target, { recursive: true, force: true });
    try {
      got =
        plan.kind === "npm"
          ? await getNpm(plan, target, io)
          : await getUv(plan, target, io);
    } catch (error) {
      await rm(target, { recursive: true, force: true });
      throw error;
    }
  }
  await write({
    version: plan.version,
    via,
    cmd: got.cmd,
    ...(got.node && { node: true }),
    args: plan.args,
    env: plan.env,
  });
  for (const name of await readdir(dir))
    if (
      versionName.test(name) &&
      name !== "current.json" &&
      name !== plan.version &&
      name !== previous?.version
    )
      await rm(join(dir, name), { recursive: true, force: true });
  return (await installedIn(dir))!;
}
