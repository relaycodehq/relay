// Shared by Relay's own polled reads (electron/git) and a read-only agent
// turn's git (electron/agents), which can't import each other's folders.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * The commands Git LFS installs. They run the `git-lfs` on PATH, not
 * anything the repository brought, and without them a polled status would
 * hash a touched LFS file whole and call it modified.
 */
const lfsCommands = new Set([
  "git-lfs clean -- %f",
  "git-lfs smudge -- %f",
  "git-lfs filter-process",
]);

/** Config the person set up themselves; the rest came with the folder. */
const ownScopes = new Set(["system", "global", "command"]);

type ConfigEntry = { scope: string; key: string; value: string };

/** `git config --show-scope -z --get-regexp` output, one entry per key. */
function configEntries(listed: string) {
  const fields = listed.split("\0");
  const entries: ConfigEntry[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [key, value = ""] = fields[i + 1].split(/\n(.*)/s);
    entries.push({ scope: fields[i], key, value });
  }
  return entries;
}

/** The config keys matching `pattern`, each with the scope it came from. */
async function configMatching(
  file: string,
  root: string,
  env: NodeJS.ProcessEnv,
  pattern: string,
) {
  const listed = await exec(
    file,
    ["-C", root, "config", "--show-scope", "-z", "--get-regexp", pattern],
    { env, timeout: 15000 },
  ).then(
    ({ stdout }) => stdout,
    // None set exits 1; config Git can't read fails the read itself too.
    () => "",
  );
  return configEntries(listed);
}

/**
 * Diff settings from the repository's own config that name a command: a
 * driver's `textconv` or `command`, and `diff.external`.
 */
export async function foreignDiffCommandKeys(
  file: string,
  root: string,
  env: NodeJS.ProcessEnv,
) {
  const entries = await configMatching(
    file,
    root,
    env,
    "^diff\\.(external|.*\\.(textconv|command))$",
  );
  return entries
    .filter(({ scope }) => !ownScopes.has(scope))
    .map(({ key }) => key);
}

/**
 * Filter keys that name a command Relay didn't vet. A filter from the
 * repository's own config (`.git/config`, a worktree's config, or a file
 * either includes) is foreign unless it's Git LFS. LFS runs any
 * `lfs.extension.<x>.clean` command in the config, so once the repository
 * names one, every LFS filter is foreign too, the user's global one included.
 */
export async function foreignFilterKeys(
  file: string,
  root: string,
  env: NodeJS.ProcessEnv,
) {
  const entries = await configMatching(
    file,
    root,
    env,
    "^(filter\\..*\\.(clean|smudge|process)|lfs\\.extension\\..*)$",
  );
  const repositoryExtendsLfs = entries.some(
    ({ scope, key }) =>
      key.startsWith("lfs.extension.") && !ownScopes.has(scope),
  );
  const keys: string[] = [];
  for (const { scope, key, value } of entries) {
    if (!key.startsWith("filter.")) continue;
    const trusted = lfsCommands.has(value)
      ? !repositoryExtendsLfs
      : ownScopes.has(scope);
    if (!trusted) keys.push(key);
  }
  return keys;
}

/**
 * The `-c` settings that empty each filter key, which passes content
 * through untouched. `-c` can't spell a key with `=` in it, as Git splits
 * at the first one, so a read in a repository with such a filter is
 * refused instead.
 */
export function filtersEmptied(keys: string[]) {
  const settings: string[] = [];
  for (const key of keys) {
    if (key.includes("="))
      throw new Error(
        `This repository's config names a filter Relay can't switch off for a read (${key}).`,
      );
    const name = key.slice("filter.".length, key.lastIndexOf("."));
    settings.push("-c", `${key}=`, "-c", `filter.${name}.required=false`);
  }
  return settings;
}
