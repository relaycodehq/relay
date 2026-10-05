import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * OpenCode runs every thread in one server, so a worktree's RELAY_PORT_OFFSET
 * and friends can't go in that server's environment. A plugin Relay hands the
 * server adds them to each shell command instead, looked up by the folder the
 * command runs in from a file Relay updates as turns start.
 */
let root: string | undefined;

/** Where the plugin and its folder → variables file live; unset, OpenCode gets neither. */
export function setOpenCodeEnvRoot(dir: string) {
  root = dir;
}

const mapFile = (dir: string) => join(dir, "worktree-env.json");
const pluginFile = (dir: string) => join(dir, "relay-worktree-env.js");

// Read on every command: a turn can start in a worktree after the server did.
const pluginSource = (file: string) => `import { readFileSync } from "node:fs";
import { sep } from "node:path";

const file = ${JSON.stringify(file)};

export const RelayWorktreeEnv = async () => ({
  "shell.env": async (input, output) => {
    let folders;
    try {
      folders = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return;
    }
    const cwd = input.cwd ?? "";
    const folder = Object.keys(folders)
      .filter((dir) => cwd === dir || cwd.startsWith(dir + sep))
      .sort((a, b) => b.length - a.length)[0];
    if (folder) Object.assign(output.env, folders[folder]);
  },
});
`;

/**
 * `env` with Relay's plugin added to whatever OPENCODE_CONFIG_CONTENT it
 * already carries; unchanged when that isn't JSON Relay can extend.
 */
export async function withWorktreeEnvPlugin(
  env: Record<string, string>,
): Promise<Record<string, string>> {
  if (!root) return env;
  let config: { plugin?: unknown };
  try {
    config = JSON.parse(env.OPENCODE_CONFIG_CONTENT || "{}");
  } catch {
    return env;
  }
  if (!config || typeof config !== "object" || Array.isArray(config))
    return env;
  await mkdir(root, { recursive: true });
  await writeFile(pluginFile(root), pluginSource(mapFile(root)));
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  return {
    ...env,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...config,
      plugin: [...plugins, pathToFileURL(pluginFile(root)).href],
    }),
  };
}

let writing = Promise.resolve();

/** What shell commands run in `directory` are told from now on; nothing when `env` is empty. */
export function rememberWorktreeEnv(
  directory: string,
  env: Record<string, string> = {},
) {
  const dir = root;
  if (!dir) return writing;
  writing = writing
    .then(async () => {
      const file = mapFile(dir);
      const folders: Record<string, Record<string, string>> = await readFile(
        file,
        "utf8",
      )
        .then(JSON.parse)
        .catch(() => ({}));
      // OpenCode names a command's folder by its real path (/private/tmp, not /tmp).
      const folder = await realpath(directory).catch(() => directory);
      if (Object.keys(env).length) folders[folder] = env;
      else if (folder in folders) delete folders[folder];
      else return;
      await mkdir(dir, { recursive: true });
      // Whole or not at all: the plugin reads it while commands run.
      await writeFile(`${file}.tmp`, JSON.stringify(folders));
      await rename(`${file}.tmp`, file);
    })
    .catch((error) =>
      console.warn("Could not record a worktree's OpenCode variables:", error),
    );
  return writing;
}
