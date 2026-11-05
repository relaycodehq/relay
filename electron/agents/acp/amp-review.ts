import { mkdtemp, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  allowedFlags,
  disguisedFlag,
  gitBareWrites,
  gitListings,
  gitReads,
  plain,
} from "../../agent-host/read-only-bash";
import { writeFileAtomic } from "../../util/atomic-write";

// amp-acp never asks Relay before a tool runs, so a read-only turn can't be
// held back over ACP. Amp's own permission rules can: the process gets a copy
// of the user's settings whose rules allow reading and reject everything else.

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const oneOf = (words: Iterable<string>) =>
  `(?:${[...words].map(escape).join("|")})`;

// Words are read the way bash and zsh read them, so a `;` or newline inside
// quotes doesn't end a command here while the shell reads on past it.

/** Between the words of one command; a newline ends the command instead. */
const blank = "[ \\t]";
/** `$NAME` or `${NAME}`, which only read a variable; as read-only-bash's `variable`. */
const variable = "\\$(?:[A-Za-z]\\w*(?![\\w[])|\\{[A-Za-z]\\w*\\})";
const singleQuoted = "'[^']*'";
const doubleQuoted = `"(?:[^"\\\\$\`]|\\\\[\\s\\S]|${variable}|\\$(?="))*"`;
/** Not a backslash-newline, which joins the next line to this command. */
const escaped = "\\\\[^\\n]";
/**
 * What the shell takes as it is. Not parentheses, which open subshells and
 * zsh's `*(e:…:)` and `=(…)`, nor `#`, a comment the shell skips to the end
 * of its line.
 */
const literal = "[^\\s;&|'\"\\\\$()<>`#]";
const redirect = "[12]?>(?:&[12]|[ \\t]*\\/dev\\/null)(?=[\\s;&|]|$)";
const word = `(?:${redirect}|(?:${singleQuoted}|${doubleQuoted}|${escaped}|${variable}|\\$(?=[\\s;&|]|$)|${literal})+)`;

/** The rest of one command, up to the next `;`, `&&`, `||`, `|` or newline. */
const rest = `(?:${blank}+${word})*`;
const ends = "(?=[\\s;&|]|$)";

/** One piece of a command for a look ahead, which reads past a quoted `;` too. */
const piece = `(?:${singleQuoted}|"(?:[^"\\\\]|\\\\[\\s\\S])*"|${escaped}|[^;&|\\n'"\\\\])`;
/** A word starting with a wildcard, which may expand to a file named like a flag. */
const globbedWord = `(?:^|\\s)(?:''|"")*[*?[{^]`;
const quotedDollar = `"(?:[^"\\\\]|\\\\[\\s\\S])*?\\$(?!")`;
/** No word of this command hides a flag from a look at its words. */
const noHiddenFlag = `(?!${piece}*?(?:${disguisedFlag}|${globbedWord}|${quotedDollar}))`;
/** No later word of this command starts with one of `flags`. */
const without = (flags: string) => `(?!${piece}*?\\s(?:${flags}))`;
/** Each word a flag `flags` allows, its value quoted or not, or an argument. */
const flagged = (flags: string) =>
  `${noHiddenFlag}(?:${blank}+(?:(?=(?:${flags})${ends})${word}|(?!-)${word}))*`;
const gitPrefix = `git${ends}${noHiddenFlag}(?:${blank}+(?:--no-pager|-C${blank}+${word}))*${blank}+`;
const sedLines = "(?:\\d+|\\$)(?:,(?:\\d+|\\$))?p";

const command = [
  `${oneOf(plain)}${ends}${rest}`,
  ...Object.entries(allowedFlags).map(
    ([name, flags]) => `${name}${ends}${flagged(flags)}`,
  ),
  `sed${ends}${noHiddenFlag}(?:${blank}+-n)+${blank}+(?:'${sedLines}'|"${sedLines}"|${sedLines})(?:${blank}+(?!-)${word})*`,
  // As gitReadsOnly: `--textconv` undoes `--no-textconv`, `--filters` runs smudge filters.
  `${gitPrefix}${oneOf(gitReads)}${ends}${without("--(?:ou|op|ext|textc|filters)|-[^-\\s]*O")}${rest}`,
  ...Object.entries(gitListings).map(
    ([sub, flags]) =>
      `${gitPrefix}${escape(sub)}(?:${blank}+${oneOf(flags)}${ends})${gitBareWrites.has(sub) ? "+" : "*"}`,
  ),
].join("|");

const segment = `\\s*(?:${command})\\s*`;

/**
 * `readsOnly` from read-only-bash as one regular expression, the form Amp's
 * rules match a command with. It may turn down more, never let more through.
 */
export const readOnlyShellPattern = new RegExp(
  [
    // Amp matches with `^` and `$` at every line, so `touch x\nls` passed
    // for its `ls`; these hold at the ends of the whole command alone.
    "(?<![\\s\\S])",
    // Writes, substitutions and here-documents, bar `>/dev/null` and `2>&1`.
    "(?![\\s\\S]*(?:[<`]|\\$\\(|>(?!\\s*\\/dev\\/null(?:\\s|$)|&1(?:\\s|$))))",
    // A lone `&` sends a command to the background.
    "(?![\\s\\S]*(?<![&>])&(?!&))",
    `${segment}(?:(?:&&|\\|\\||[;|\\n])${segment})*(?![\\s\\S])`,
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
 * A folder of its own, made once per Relay: in a /tmp other users share, a
 * fixed name is theirs to make first and swap the settings in, and one per
 * start would leave a folder behind for every read-only turn.
 */
let settingsFolder: Promise<string> | undefined;

async function writeReadOnlySettings(settings: string) {
  settingsFolder ??= mkdtemp(join(tmpdir(), "relay-amp-read-only-"));
  const folder = settingsFolder;
  const dir = await folder.catch((error) => {
    if (settingsFolder === folder) settingsFolder = undefined;
    throw error;
  });
  const path = join(dir, "settings.json");
  await writeFileAtomic(path, settings);
  return path;
}

/**
 * The environment that starts Amp on the read-only settings, written fresh
 * for each process, and a warning when the project's own rules win over them.
 */
export async function readOnlyEnv(cwd: string) {
  const settings = JSON.stringify(
    readOnlySettings(await userSettings()),
    null,
    2,
  );
  const path = await writeReadOnlySettings(settings).catch((error) => {
    // Its folder was cleared out of the temp dir: make a new one.
    if (error?.code !== "ENOENT") throw error;
    settingsFolder = undefined;
    return writeReadOnlySettings(settings);
  });
  const overriding = await overridingWorkspace(cwd);
  return {
    env: { AMP_SETTINGS_FILE: path },
    warning:
      overriding &&
      `${overriding} sets Amp's permissions for this project, and Amp puts those before Relay's read-only rules, so it may change files while it reviews.`,
  };
}
