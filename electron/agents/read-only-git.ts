import {
  foreignDiffCommandKeys,
  foreignFilterKeys,
} from "../git-config/repository-filters";

/**
 * Git settings added to a read-only turn's agent process. A checkout can
 * commit a bare repository whose config sets `core.worktree` and a
 * `core.fsmonitor` command, which `git -C that.git status` runs. With
 * `safe.bareRepository=explicit` git opens a bare repository only when told
 * to with `--git-dir`. `core.fsmonitor=false` keeps a checkout's own
 * `.git/config` from naming a command for `git status` to run, and the
 * signature programs go back to Git's defaults so that config can't name
 * one for `git log` to run on a signed commit. The settings go after any
 * the environment already passes. They ride in `GIT_CONFIG_PARAMETERS`
 * rather than `GIT_CONFIG_KEY_<n>`: Codex drops names containing KEY from a shell's
 * environment but keeps the count, and git then refuses every command.
 * Each is spelled `'key=value'`, not `'key'='value'`: git before 2.31
 * reads only the first and refuses every command on the second.
 */
export function readOnlyGitEnv(
  base: Record<string, string | undefined>,
  checkoutSettings: string[] = [],
): Record<string, string> {
  const settings = [
    "'safe.bareRepository=explicit'",
    "'core.fsmonitor=false'",
    "'gpg.program=gpg'",
    "'gpg.ssh.program=ssh-keygen'",
    "'gpg.x509.program=gpgsm'",
    ...checkoutSettings,
  ].join(" ");
  const inherited = base.GIT_CONFIG_PARAMETERS?.trim();
  return {
    GIT_CONFIG_PARAMETERS: inherited ? `${inherited} ${settings}` : settings,
  };
}

/**
 * The read-only settings for a turn in `root`, plus ones switching off the
 * commands that checkout's own config hooks into reads: its filters, which
 * `git status` and `git diff` run on a touched file, and its diff commands.
 * This covers every agent's shell, hook or not. A driver's `textconv`
 * becomes `cat`, which prints the file as it is. An emptied external diff
 * command makes a plain `git diff` fail instead of running one; Git has no
 * setting to unset it, and `--no-ext-diff` still shows the change.
 */
export async function readOnlyGitEnvIn(
  root: string,
  base: Record<string, string | undefined>,
): Promise<Record<string, string>> {
  const env = { ...base, ...readOnlyGitEnv(base) };
  const [filters, diffCommands] = await Promise.all([
    foreignFilterKeys("git", root, env),
    foreignDiffCommandKeys("git", root, env),
  ]);
  const overrides = [
    ...filters.flatMap((key) => {
      const name = key.slice("filter.".length, key.lastIndexOf("."));
      return [[key, ""], [`filter.${name}.required`, "false"]];
    }),
    ...diffCommands.map((key) => [key, textconvKey(key) ? "cat" : ""]),
  ];
  return readOnlyGitEnv(
    base,
    overrides.map(([key, value]) => configParameter(key, value)),
  );
}

const textconvKey = (key: string) => key.endsWith(".textconv");

/**
 * One `GIT_CONFIG_PARAMETERS` entry. A key with `=` in it needs the
 * `'key'='value'` form git 2.31 added; older git refuses every command on
 * it, which in such a checkout is the safe way to fail.
 */
function configParameter(key: string, value: string) {
  const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  return key.includes("=")
    ? `${quoted(key)}=${quoted(value)}`
    : quoted(`${key}=${value}`);
}
