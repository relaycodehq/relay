import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { git as gitIn } from "../git";
import { copyIncluded } from "../worktree-include";

// Readying a folder `git worktree add` just made.

/**
 * Readies a folder `git worktree add` just made: `.worktreeinclude` files
 * from `source`, then `node_modules` from the checkout `root` unless the
 * include brought its own. Setup is still to run in it.
 */
export async function bootstrap(root: string, source: string, path: string) {
  const included = await copyIncluded(source, path);
  await linkModules(root, path);
  return {
    setup: "pending" as const,
    ...(included.length ? { included } : {}),
  };
}

async function linkModules(root: string, path: string) {
  const source = join(root, "node_modules");
  const info = await lstat(source).catch(() => null);
  if (
    !info?.isDirectory() ||
    (await lstat(join(path, "node_modules")).catch(() => null))
  )
    return;
  // Judged on the checkout's real folder: the usual `node_modules/` rule
  // matches folders only, never the link standing in for one.
  if (!(await ignoresModules(root))) return;
  const link = join(path, "node_modules");
  await symlink(source, link, "dir").catch(() => {});
  if (await ignoresModules(path)) return;
  // The repository's shared exclude keeps the link out of the thread's
  // changes; the checkout already ignores its folder, so nothing shows there.
  try {
    const file = resolve(
      path,
      (await gitIn(path, ["rev-parse", "--git-path", "info/exclude"])).trim(),
    );
    const before = await readFile(file, "utf8").catch(() => "");
    if (!before.split(/\r?\n/).includes("/node_modules")) {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(
        file,
        `${before && !before.endsWith("\n") ? "\n" : ""}/node_modules\n`,
      );
    }
  } catch (e) {
    console.warn("[worktrees] could not exclude the node_modules link", e);
  }
  // A link Git still doesn't ignore would show up as the thread's own change.
  if (!(await ignoresModules(path))) await rm(link, { force: true });
}

const ignoresModules = (dir: string) =>
  // check-ignore rejects literal pathspec magic outright.
  gitIn(dir, ["check-ignore", "-q", "node_modules"], {
    env: { GIT_LITERAL_PATHSPECS: undefined },
  }).then(
    () => true,
    () => false,
  );
