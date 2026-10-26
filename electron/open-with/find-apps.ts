import { constants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { knownApps, type JetBrainsInstall, type KnownApp } from "./known-apps";

/** A known app on this computer, and the bundle, program or command that starts it. */
export interface FoundApp {
  id: string;
  name: string;
  path: string;
}

type Listing = { dir: string; names: Set<string> };

const exists = (path: string, mode = constants.F_OK) =>
  access(path, mode).then(
    () => true,
    () => false,
  );

const namesIn = (dir: string) => readdir(dir).catch(() => [] as string[]);

const list = (dirs: string[]): Promise<Listing[]> =>
  Promise.all(
    [...new Set(dirs)].map(async (dir) => ({
      dir,
      names: new Set(await namesIn(dir)),
    })),
  );

/** "PhpStorm 2025.2" before "PhpStorm 2025.1.3". */
const newestFirst = (a: string, b: string) =>
  b.localeCompare(a, undefined, { numeric: true });

async function firstExisting(paths: string[]) {
  for (const path of paths) if (await exists(path)) return path;
}

const found = (app: KnownApp, path: string | undefined) =>
  path ? [{ id: app.id, name: app.name, path }] : [];

/** The known apps among the bundles in `dirs`, the Applications folders, searched in that order. */
export async function findMacApps(
  dirs: string[],
  known = knownApps,
): Promise<FoundApp[]> {
  const listings = await list(dirs);
  const bundleOf = (app: KnownApp) => {
    for (const bundle of app.mac ?? [])
      for (const { dir, names } of listings)
        if (names.has(bundle)) return join(dir, bundle);
  };
  return known.flatMap((app) => found(app, bundleOf(app)));
}

/** The known apps whose commands are in `dirs`, PATH's folders and the like. */
export async function findLinuxApps(
  dirs: string[],
  known = knownApps,
): Promise<FoundApp[]> {
  const listings = await list(dirs.filter(Boolean));
  const commandOf = async (app: KnownApp) => {
    for (const command of app.linux ?? [])
      for (const { dir, names } of listings) {
        const path = join(dir, command);
        if (names.has(command) && (await exists(path, constants.X_OK)))
          return path;
      }
  };
  const paths = await Promise.all(known.map(commandOf));
  return known.flatMap((app, i) => found(app, paths[i]));
}

/** The known apps in Windows' usual install folders, which `env` names. */
export async function findWindowsApps(
  env: Record<string, string | undefined>,
  known = knownApps,
): Promise<FoundApp[]> {
  const programOf = async (app: KnownApp) =>
    (await firstExisting(
      (app.windows ?? []).flatMap((template) => expand(template, env) ?? []),
    )) ??
    (app.jetbrains && (await jetBrainsProgram(app.jetbrains, env)));
  const paths = await Promise.all(known.map(programOf));
  return known.flatMap((app, i) => found(app, paths[i]));
}

/** `%NAME%/rest` under the folder `env` gives NAME; undefined when it gives none. */
function expand(template: string, env: Record<string, string | undefined>) {
  const [, name, rest] = /^%([^%]+)%\/(.+)$/.exec(template) ?? [];
  const base = name ? env[name] : undefined;
  return base ? join(base, rest) : undefined;
}

/** A JetBrains IDE's program, newest version first; see JetBrainsInstall. */
async function jetBrainsProgram(
  { folders, toolbox, exe }: JetBrainsInstall,
  env: Record<string, string | undefined>,
) {
  const program = (dir: string) => join(dir, "bin", exe);
  const candidates: string[] = [];
  if (env.ProgramFiles) {
    const root = join(env.ProgramFiles, "JetBrains");
    const installs = (await namesIn(root))
      .filter((name) => folders.some((folder) => isVersionOf(name, folder)))
      .sort(newestFirst);
    candidates.push(...installs.map((name) => program(join(root, name))));
  }
  const local = env.LOCALAPPDATA;
  if (local) {
    candidates.push(
      ...folders.map((folder) => program(join(local, "Programs", folder))),
    );
    const apps = join(local, "JetBrains", "Toolbox", "apps", toolbox);
    for (const channel of await namesIn(apps)) {
      if (!channel.startsWith("ch-")) continue;
      const builds = (await namesIn(join(apps, channel))).sort(newestFirst);
      candidates.push(
        ...builds.map((build) => program(join(apps, channel, build))),
      );
    }
  }
  return firstExisting(candidates);
}

/** "IntelliJ IDEA 2025.2" is IntelliJ IDEA; "IntelliJ IDEA Community Edition 2025.2" isn't. */
const isVersionOf = (name: string, folder: string) =>
  name === folder ||
  (name.startsWith(`${folder} `) && /^\d/.test(name.slice(folder.length + 1)));
