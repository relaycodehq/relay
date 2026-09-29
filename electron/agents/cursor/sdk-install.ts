import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { compareVersions } from "../../../shared/agent-updates";
import lockfile from "../../../packaging/cursor-sdk.lock.json";
import { tarFiles } from "./tar";

/**
 * Relay doesn't ship Cursor's SDK: it downloads it on first use, and again to
 * update it. The SDK itself and its platform package come straight from npm;
 * what they depend on is pinned in `packaging/cursor-sdk.lock.json`, so a
 * newer SDK only installs when it asks for the same dependencies.
 */
export interface SdkLock {
  sdk: string;
  node?: string;
  dependencies: Record<string, string>;
  packages: Record<
    string,
    {
      version: string;
      resolved: string;
      integrity: string;
      os?: string[];
      cpu?: string[];
    }
  >;
}
export const sdkLock: SdkLock = lockfile;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const registry = "https://registry.npmjs.org/";
/** Newer releases wait this long before Relay offers them. */
const soak = 3 * 24 * 60 * 60 * 1000;
const sdkName = "@cursor/sdk";
const entryPath = "node_modules/@cursor/sdk/dist/esm/index.js";

/** The SDK wants something the pinned dependencies don't give; a newer Relay does. */
export class NeedsRelayUpdate extends Error {}

export interface InstalledSdk {
  version: string;
  dir: string;
  /** The file to `import()` to get the SDK. */
  entry: string;
}

const pointer = (root: string) => join(root, "current.json");

/** The SDK Relay installed, if it's still all there. */
export async function installedSdk(
  root: string,
): Promise<InstalledSdk | undefined> {
  try {
    const { version } = JSON.parse(await readFile(pointer(root), "utf8"));
    if (typeof version !== "string" || !/^[\w.-]+$/.test(version)) return;
    const dir = join(root, version);
    const entry = join(dir, entryPath);
    await access(entry);
    return { version, dir, entry };
  } catch {
    return undefined;
  }
}

const platformPackage = (platform: string, arch: string) =>
  `@cursor/sdk-${platform}-${arch}`;

interface Download {
  path: string;
  url: string;
  integrity: string;
}

const npmUrl = (name: string, version?: string) =>
  registry + name.replace("/", "%2F") + (version ? `/${version}` : "");

async function json<T>(fetch: Fetch, url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`npm answered ${response.status} for ${url}.`);
  return (await response.json()) as T;
}

interface Manifest {
  version: string;
  dependencies?: Record<string, string>;
  dist?: { tarball?: string; integrity?: string };
}

/** The newest stable SDK that has been out for a few days, or undefined when none. */
export async function latestSdkVersion(
  fetch: Fetch,
  now = Date.now(),
): Promise<string | undefined> {
  const packument = await json<{
    versions: Record<string, unknown>;
    time?: Record<string, string>;
  }>(fetch, npmUrl(sdkName));
  return Object.keys(packument.versions)
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .filter((v) => {
      const published = Date.parse(packument.time?.[v] ?? "");
      return Number.isFinite(published) && now - published >= soak;
    })
    .sort(compareVersions)
    .at(-1);
}

/** What to download for `version` on this machine. */
async function plan(
  fetch: Fetch,
  lock: SdkLock,
  version: string,
  platform: string,
  arch: string,
): Promise<Download[]> {
  const own = platformPackage(platform, arch);
  if (!lock.packages[`node_modules/${own}`])
    throw new Error(`Cursor's SDK has no build for ${platform} ${arch}.`);
  const downloads = new Map<string, Download>();
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (pkg.os && !pkg.os.includes(platform)) continue;
    if (pkg.cpu && !pkg.cpu.includes(arch)) continue;
    downloads.set(path, {
      path,
      url: pkg.resolved,
      integrity: pkg.integrity,
    });
  }
  if (version === lock.sdk) return [...downloads.values()];

  const manifest = await json<Manifest>(fetch, npmUrl(sdkName, version));
  if (!sameDependencies(manifest.dependencies, lock.dependencies))
    throw new NeedsRelayUpdate(
      `Cursor SDK ${version} needs dependencies this Relay doesn't have. Update Relay to use it.`,
    );
  const platformManifest = await json<Manifest>(fetch, npmUrl(own, version));
  for (const [path, found] of [
    ["node_modules/@cursor/sdk", manifest],
    [`node_modules/${own}`, platformManifest],
  ] as const) {
    const { tarball, integrity } = found.dist ?? {};
    if (!tarball?.startsWith(registry) || !integrity)
      throw new Error(`npm has no verifiable download for ${path}.`);
    downloads.set(path, { path, url: tarball, integrity });
  }
  return [...downloads.values()];
}

function sameDependencies(
  a: Record<string, string> = {},
  b: Record<string, string> = {},
) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/** Throws unless `data` is what `integrity` (npm's `sha512-…` form) says. */
function verifyIntegrity(data: Buffer, integrity: string) {
  const candidates = integrity
    .split(/\s+/)
    .map((part) => /^(sha512|sha384|sha256)-(.+)$/.exec(part))
    .filter((m): m is RegExpExecArray => !!m);
  if (!candidates.length) throw new Error("The download has no usable hash.");
  const ok = candidates.some(
    ([, algorithm, digest]) =>
      createHash(algorithm).update(data).digest("base64") === digest,
  );
  if (!ok) throw new Error("A download didn't match its hash. Try again.");
}

const gunzipAsync = promisify(gunzip);

async function fetchPackage(fetch: Fetch, download: Download, into: string) {
  if (!download.url.startsWith(registry))
    throw new Error(`Refusing to download from ${download.url}.`);
  const response = await fetch(download.url);
  if (!response.ok)
    throw new Error(
      `Downloading ${download.path} failed (${response.status}).`,
    );
  const data = Buffer.from(await response.arrayBuffer());
  verifyIntegrity(data, download.integrity);
  const target = join(into, download.path);
  for (const file of tarFiles(await gunzipAsync(data))) {
    const path = resolve(target, file.path);
    if (path !== target && !path.startsWith(target + sep))
      throw new Error(`${download.path} has a file outside itself.`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.data, { mode: file.mode });
  }
}

interface InstallOptions {
  version?: string;
  platform?: string;
  arch?: string;
  /** What to pin the dependencies to; the tests' own. */
  lock?: SdkLock;
}

let installing: Promise<InstalledSdk> | undefined;

/**
 * Installs `version` (the pinned one by default) under `root/<version>` and
 * makes it the one Relay uses. Concurrent calls share one download.
 */
export function installSdk(
  root: string,
  fetch: Fetch,
  options: InstallOptions = {},
): Promise<InstalledSdk> {
  installing ??= install(root, fetch, options).finally(
    () => (installing = undefined),
  );
  return installing;
}

async function install(
  root: string,
  fetch: Fetch,
  {
    lock = sdkLock,
    version = lock.sdk,
    platform = process.platform,
    arch = process.arch,
  }: InstallOptions,
): Promise<InstalledSdk> {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`${version} isn't a Cursor SDK version.`);
  const downloads = await plan(fetch, lock, version, platform, arch);
  await mkdir(root, { recursive: true });
  const staging = join(root, `.installing-${process.pid}-${Date.now()}`);
  const dir = join(root, version);
  try {
    for (const download of downloads)
      await fetchPackage(fetch, download, staging);
    const entry = join(staging, entryPath);
    const manifest = JSON.parse(
      await readFile(
        join(staging, "node_modules/@cursor/sdk/package.json"),
        "utf8",
      ),
    ) as Manifest;
    if (manifest.version !== version)
      throw new Error(
        `Downloaded Cursor SDK ${manifest.version}, not ${version}.`,
      );
    await access(entry);
    await rm(dir, { recursive: true, force: true });
    await rename(staging, dir);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const previous = await installedSdk(root);
  await writeFile(pointer(root), JSON.stringify({ version }));
  // The one before stays, in case the new one turns out not to run.
  for (const name of await readdir(root))
    if (
      /^\d+\.\d+\.\d+$/.test(name) &&
      name !== version &&
      name !== previous?.version
    )
      await rm(join(root, name), { recursive: true, force: true });
  return { version, dir, entry: join(dir, entryPath) };
}
