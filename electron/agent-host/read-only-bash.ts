// A reviewer's Bash, held to commands Relay knows only read. Claude Code's
// own read-only check runs after this, but a permission allow rule in the
// user's settings approves a call before canUseTool can turn it down, so the
// line has to be drawn in a PreToolUse hook, which runs first.

// Not `file`: `file -C` compiles a magic file and writes it beside it.
export const plain = new Set([
  "cd",
  "pwd",
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "stat",
  "du",
  "echo",
  "true",
  "which",
  "basename",
  "dirname",
  "realpath",
  "nl",
  "cut",
  "tr",
  "diff",
  "jq",
  "grep",
  "egrep",
  "fgrep",
]);
export const gitReads = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "cat-file",
  "merge-base",
  "describe",
  "shortlog",
  "diff-tree",
  "show-ref",
  "for-each-ref",
  "name-rev",
  "range-diff",
]);
/** Subcommands that only read with these flags and nothing else. */
export const gitListings: Record<string, Set<string>> = {
  branch: new Set([
    "-a",
    "-r",
    "-v",
    "-vv",
    "--all",
    "--remotes",
    "--list",
    "--show-current",
    "--no-color",
  ]),
  remote: new Set(["-v"]),
  stash: new Set(["list"]),
};
/** Listings that change something when given no arguments: a bare `git stash` stashes. */
export const gitBareWrites = new Set(["stash"]);

/**
 * Spellings the shell turns into a flag that a look at the words misses: a
 * quote or backslash before or inside its name (`'--output=x'`, `-de''lete`),
 * a glob or brace right after it, brace expansion (`{-delete,-true}`) and `$`
 * expansions (`${X:--delete}`, `$'\x2ddelete'`). A `$` ending a word, as in
 * `rg 'foo$'`, and sed's `'1,$p'` stay allowed.
 */
export const disguisedFlag = [
  `(?:^|\\s)['"\\\\]+-`,
  `(?:^|\\s)-[\\w-]*['"\\\\]+[\\w-]`,
  `(?:^|\\s)-[\\w-]*[*?[{]`,
  `\\{[^\\s}]*(?:,|\\.\\.)`,
  `\\$(?!['"]?(?:[\\s;&|]|$)|p['"])`,
].join("|");
const disguised = new RegExp(disguisedFlag);

/** Whether every command in `command` is on Relay's list of ones that only read. */
export function readsOnly(command: string): boolean {
  const bare = command.replace(
    /(^|\s)(?:[12]?>\s*\/dev\/null|2>&1)(?=\s|$)/g,
    "$1",
  );
  // Writes, substitutions and here-documents; quoting isn't parsed, so a
  // quoted one counts too and the command is turned down.
  if (/[<>`]|\$\(/.test(bare)) return false;
  const segments = bare.split(/&&|\|\||[;|\n]/).map((s) => s.trim());
  return segments.every((s) => !!s && !s.includes("&") && segmentReads(s));
}

function segmentReads(segment: string) {
  const [name, ...args] = segment.split(/\s+/);
  const has = (pattern: RegExp) => args.some((a) => pattern.test(a));
  // Their flags decide whether they write, so a flag has to be spelled plainly.
  if (
    ["git", "rg", "sort", "tree", "find"].includes(name) &&
    disguised.test(segment)
  )
    return false;
  switch (name) {
    case "git":
      return gitReadsOnly(args);
    case "rg":
      return !has(/^--pre(=|$)/);
    case "sort":
      // Short flags cluster (`-ro`) and long ones may be cut short (`--out`).
      return !has(/^(--o|-[^-]*o)/);
    case "tree":
      return !has(/^(--o|-[^-]*o)/);
    case "find":
      return !has(
        /^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$/,
      );
    case "sed":
      return sedPrints(args);
    default:
      return plain.has(name);
  }
}

function gitReadsOnly(args: string[]) {
  let i = 0;
  while (args[i] === "--no-pager" || args[i] === "-C")
    i += args[i] === "-C" ? 2 : 1;
  const [sub, ...rest] = args.slice(i);
  if (
    // git takes a long flag cut short (`--open-fi`) and clustered short ones (`-lO`).
    rest.some((a) => /^(--(ou|op|ext)|-[^-]*O)/.test(a))
  )
    return false;
  if (gitReads.has(sub)) return true;
  const listing = gitListings[sub];
  if (!listing || (gitBareWrites.has(sub) && !rest.length)) return false;
  return rest.every((a) => listing.has(a));
}

/** `sed -n '12,40p' file`: printing lines, never editing in place. */
function sedPrints(args: string[]) {
  const flags = args.filter((a) => a.startsWith("-"));
  const [script] = args.filter((a) => !a.startsWith("-"));
  return (
    flags.length > 0 &&
    flags.every((f) => f === "-n") &&
    /^(['"]?)(\d+|\$)(,(\d+|\$))?p\1$/.test(script ?? "")
  );
}

/** The PreToolUse hook: anything off the list is turned down before allow rules can approve it. */
export async function readOnlyBashHook(input: unknown) {
  const { tool_name, tool_input } = (input ?? {}) as {
    tool_name?: string;
    tool_input?: { command?: unknown };
  };
  if (tool_name !== "Bash") return {};
  const command = tool_input?.command;
  if (typeof command === "string" && readsOnly(command)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason:
        "This review only reads the code. Use Read, Grep and Glob, or a plain read-only command like git diff, git log or rg, and report problems instead of changing files.",
    },
  };
}
