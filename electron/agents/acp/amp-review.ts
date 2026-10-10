import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  gitBareWrites,
  gitListings,
  gitReads,
  plain,
} from "../../agent-host/read-only-bash";

// amp-acp never asks Relay before a tool runs, so a read-only turn can't be
// held back over ACP. Amp's own permission rules can: the process gets a copy
// of the user's settings whose rules allow reading and reject everything else.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const oneOf = (words: Iterable<string>) =>
  `(?:${[...words].map(escape).join("|")})`;

/** The rest of one command, up to the next `;`, `&&`, `|` or newline; `2>&1` stays in it. */
const rest = "(?:>&|[^;&|\\n])*";
const ends = "(?=[\\s;&|]|$)";
/** No later argument of this command starts with one of `flags`. */
const without = (flags: string) => `(?![^;&|\\n]*\\s(?:${flags}))`;
const gitPrefix = "git(?:\\s+(?:--no-pager|-C\\s+[^\\s;&|]+))*\\s+";
const sedLines = "(?:\\d+|\\$)(?:,(?:\\d+|\\$))?p";

const command = [
  `${oneOf(plain)}${ends}${rest}`,
  `rg${ends}${without("--pre(?:=|\\s|$)")}${rest}`,
  `sort${ends}${without("-o|--output")}${rest}`,
  `tree${ends}${without("-o")}${rest}`,
  `find${ends}${without("-(?:exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)(?:\\s|$)")}${rest}`,
  `sed(?:\\s+-n)+\\s+(?:'${sedLines}'|"${sedLines}"|${sedLines})(?:\\s+[^\\s;&|<>-][^\\s;&|<>]*)*\\s*`,
  `${gitPrefix}${oneOf(gitReads)}${ends}${without("--output|-O|--open-files-in-pager|--ext-diff")}${rest}`,
  ...Object.entries(gitListings).map(
    ([sub, flags]) =>
      `${gitPrefix}${escape(sub)}(?:\\s+${oneOf(flags)}${ends})${gitBareWrites.has(sub) ? "+" : "*"}\\s*`,
  ),
].join("|");
const segment = `\\s*(?:${command})\\s*`;

/**
 * `readsOnly` from read-only-bash as one regular expression, the form Amp's
 * rules match a command with. It may turn down more, never let more through.
 */
export const readOnlyShellPattern = new RegExp(
  [
    "^",
    // Writes, substitutions and here-documents, bar `>/dev/null` and `2>&1`.
    "(?![\\s\\S]*(?:[<`]|\\$\\(|>(?!\\s*\\/dev\\/null(?:\\s|$)|&1(?:\\s|$))))",
    // A lone `&` sends a command to the background.
    "(?![\\s\\S]*(?<![&>])&(?!&))",
    `${segment}(?:(?:&&|\\|\\||[;|\\n])${segment})*$`,
  ].join(""),
);

/** Amp's tools that only read, look things up or keep the thread's own notes. */
const readingTools = [
  "Read",
  "read",
  "read_file",
  "Grep",
  "grep",
  "Glob",
  "glob",
  "finder",
  "look_at",
  "read_web_page",
  "web_search",
  "read_thread",
  "find_thread",
  "skill",
  "todo_read",
  "todo_write",
  "shell_command_status",
  "shell_command_kill",
];
const refusal =
  "This review only reads the code. Change no files, and run only commands that read, like git diff, git log, rg or cat with no redirects.";

/** The rules a read-only Amp runs under; Amp takes the first that matches. */
export const readOnlyRules = [
  ...readingTools.map((tool) => ({ tool, action: "allow" })),
  ...["shell_command", "async_shell_command", "Bash"].flatMap((tool) =>
    (tool === "Bash" ? ["cmd"] : ["command"]).map((key) => ({
      tool,
      matches: { [key]: `/${readOnlyShellPattern.source}/` },
      action: "allow",
    })),
  ),
  { tool: "*", action: "reject", message: refusal },
];

/** The user's settings with Relay's rules in place of theirs; their own allow rules would come first. */
export function readOnlySettings(user: Record<string, unknown>) {
  const {
    "amp.permissions": _permissions,
    "amp.commands.allowlist": _allowlist,
    "amp.dangerouslyAllowAll": _all,
    ...kept
  } = user;
  return {
    ...kept,
    "amp.dangerouslyAllowAll": false,
    "amp.permissions": readOnlyRules,
  };
}

/** Where Amp reads the user's settings; a commented `settings.jsonc` is skipped. */
async function userSettings(): Promise<Record<string, unknown>> {
  const path =
    process.env.AMP_SETTINGS_FILE ||
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      "amp",
      "settings.json",
    );
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (e) {
    console.warn(`Amp's settings at ${path} aren't plain JSON; a read-only Amp runs without them:`, e);
    return {};
  }
}

/**
 * A project's `.amp/settings.json` from the checkout up, whose rules Amp puts
 * before the settings file it's given: measured with Amp 0.0.1791288059.
 */
async function overridingWorkspace(cwd: string) {
  for (let dir = cwd; ; dir = dirname(dir)) {
    for (const name of ["settings.json", "settings.jsonc"]) {
      const path = join(dir, ".amp", name);
      const text = await readFile(path, "utf8").catch(() => "");
      if (/"amp\.(permissions|dangerouslyAllowAll|commands\.)/.test(text)) return path;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * The environment that starts Amp on the read-only settings, written fresh
 * for each process, and a warning when the project's own rules win over them.
 */
export async function readOnlyEnv(cwd: string) {
  const dir = join(tmpdir(), "relay-amp-read-only");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "settings.json");
  const temp = `${path}.${process.pid}.${Date.now()}`;
  await writeFile(temp, JSON.stringify(readOnlySettings(await userSettings()), null, 2));
  await rename(temp, path);
  const overriding = await overridingWorkspace(cwd);
  return {
    env: { AMP_SETTINGS_FILE: path },
    warning:
      overriding &&
      `${overriding} sets Amp's permissions for this project, and Amp puts those before Relay's read-only rules, so it may change files while it reviews.`,
  };
}
