// Which folders an agent may ask to add as a project. The user confirms every
// one, but a few are refused before anyone is asked: an agent never needs the
// whole disk, the home folder, the system's or Relay's own, and a folder that
// is or holds a project already is answered by that project.
import { realpath, stat } from "node:fs/promises";
import { posix, win32 } from "node:path";

export interface FolderRules {
  home: string;
  /** Relay's own data, worktrees and Scratchpad folders included. */
  userData: string;
  /** The system's temporary folder, which the folders inside of are fine. */
  temp: string;
  platform: NodeJS.Platform;
  projects: readonly { id: string; name: string; path: string }[];
}

export type FolderVerdict =
  | { kind: "ok" }
  | { kind: "refused"; reason: string }
  | { kind: "existing"; id: string };

/** Home folders that hold everything of one kind; a repository inside one is fine. */
const homeShelves = [
  "Desktop",
  "Documents",
  "Downloads",
  "Library",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  "Videos",
  "Applications",
];
/** Home folders no agent has business in, nor anywhere inside; so are all of home's dot-folders. */
const homeSecrets = ["Library", "AppData"];
const systemTrees: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [
    "/System",
    "/Library",
    "/Applications",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/dev",
    "/private/etc",
  ],
  linux: [
    "/usr",
    "/etc",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/boot",
    "/proc",
    "/sys",
    "/dev",
    "/var/lib",
  ],
};
const windowsTrees = [
  "Windows",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
];
/** Where drives are mounted, and how deep their roots sit below it. */
const mountShelves: Partial<Record<NodeJS.Platform, [string, number][]>> = {
  darwin: [["/Volumes", 1]],
  // /media/<user>/<drive>, /run/media/<user>/<drive>, and WSL's /mnt/c.
  linux: [
    ["/media", 2],
    ["/run/media", 2],
    ["/mnt", 1],
  ],
};
/** Not inside, only the folder itself: what's in them is often a checkout. */
const systemShelves: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: ["/private/tmp", "/private/var", "/private/var/folders"],
};

/** Whether an added folder at `real` is refused, already a project, or fine. */
export function folderVerdict(real: string, rules: FolderRules): FolderVerdict {
  const windows = rules.platform === "win32";
  const path = windows ? win32 : posix;
  // macOS and Windows file systems ignore case, so a refusal must too.
  const key = (p: string) =>
    rules.platform === "linux"
      ? path.resolve(p)
      : path.resolve(p).toLowerCase();
  const same = (a: string, b: string) => key(a) === key(b);
  const inside = (root: string, p: string) => {
    const rel = path.relative(key(root), key(p));
    return (
      rel === "" ||
      (rel !== ".." &&
        !rel.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(rel))
    );
  };
  const refuse = (reason: string): FolderVerdict => ({
    kind: "refused",
    reason,
  });
  const { root } = path.parse(real);
  if (same(real, root)) return refuse("That's the whole disk.");
  if (same(real, rules.home)) return refuse("That's the user's home folder.");
  if (inside(real, rules.home))
    return refuse("That folder holds the user's home folder.");
  if (inside(rules.userData, real))
    return refuse("That's Relay's own data, its worktrees included.");
  if (inside(real, rules.userData))
    return refuse("That folder holds Relay's own data.");
  const homes = path.dirname(rules.home);
  if (!same(homes, root) && same(path.dirname(real), homes))
    return refuse("That's another user's home folder.");
  const below = (shelf: string) => {
    const rel = path.relative(key(shelf), key(real));
    return rel === "" ? 0 : rel.split(path.sep).length;
  };
  if (
    (mountShelves[rules.platform] ?? []).some(
      ([shelf, depth]) => inside(shelf, real) && below(shelf) <= depth,
    )
  )
    return refuse(
      "That's a whole mounted drive; add the folder inside it the task needs.",
    );
  if (same(real, rules.temp))
    return refuse("That's the system's temporary folder; pick one inside it.");
  // Its first folder below home, as spelled on disk.
  const top = inside(rules.home, real)
    ? path.resolve(real).split(path.sep)[
        path.resolve(rules.home).split(path.sep).length
      ]
    : undefined;
  if (
    top &&
    (top.startsWith(".") ||
      homeSecrets.some((name) =>
        same(path.join(rules.home, name), path.join(rules.home, top)),
      ))
  )
    return refuse(`Agents don't add anything in ~${path.sep}${top}.`);
  for (const name of homeShelves)
    if (same(real, path.join(rules.home, name)))
      return refuse(
        `~${path.sep}${name} holds too much at once; add the folder inside it the task needs.`,
      );
  const trees = windows
    ? windowsTrees.map((name) => path.join(root, name))
    : (systemTrees[rules.platform] ?? []);
  if (trees.some((tree) => inside(tree, real)))
    return refuse("That's a system folder.");
  if (
    (!windows && same(path.dirname(real), root)) ||
    (systemShelves[rules.platform] ?? []).some((shelf) => same(real, shelf))
  )
    return refuse(
      "That's a system folder; add the folder inside it the task needs.",
    );
  const existing = rules.projects.find((p) => same(p.path, real));
  if (existing) return { kind: "existing", id: existing.id };
  const holder = rules.projects.find((p) => inside(p.path, real));
  if (holder)
    return refuse(
      `That's inside the project “${holder.name}” (${holder.id}); start threads there instead.`,
    );
  const held = rules.projects.find((p) => inside(real, p.path));
  if (held)
    return refuse(
      `That folder holds the project “${held.name}” (${held.id}) and would hand every agent in it the rest too. Add the folder the task needs, or ask the user to add this one themselves.`,
    );
  return { kind: "ok" };
}

/** The folder `asked` names on disk, links followed, or why it can't be one. */
export async function realFolder(
  asked: string,
  platform: NodeJS.Platform,
): Promise<{ real: string } | { refused: string }> {
  const path = platform === "win32" ? win32 : posix;
  if (!path.isAbsolute(asked))
    return { refused: "Give the folder's absolute path." };
  const real = await realpath(asked).catch(() => undefined);
  if (!real) return { refused: `There's no folder at ${asked}.` };
  if (!(await stat(real)).isDirectory())
    return { refused: `${asked} is a file, not a folder.` };
  return { real };
}
