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
const respellings = [
  `(?:^|\\s)['"\\\\]+-`,
  `(?:^|\\s)-[\\w-]*['"\\\\]+[\\w-]`,
  `(?:^|\\s)-[\\w-]*[*?[{]`,
  `\\$(?!['"]?(?:[\\s;&|]|$)|p['"])`,
];

// Not past another `{`: from each one to the end, a long run took minutes.
const braceList = `\\{[^\\s{}]*(?:,|\\.\\.)`;
export const disguisedFlag = [...respellings, braceList].join("|");
const respelled = new RegExp(respellings.join("|"));
const braces = new RegExp(braceList);

// Quotes keep the shell from expanding braces, so `rg -g '*.{ts,tsx}'` reads;
// with a backslash about, a quote may not be one, so any brace counts.
const disguised = {
  test: (segment: string) =>
    respelled.test(segment) ||
    braces.test(
      segment.includes("\\")
        ? segment
        : segment.replace(/'[^']*'|"[^"]*"/g, "''"),
    ),
};

const value = "[^\\s;&|]*";
/** Short flags that may cluster (`-in`), then at most one taking a value (`-A3`, `-t ts`). */
const shorts = (bare: string, valued = "") =>
  `-[${bare}]*${valued ? `(?:[${valued}]${value})?` : ""}`;
const longs = (bare: string[], valued: string[] = []) =>
  [
    `--(?:${bare.join("|")})`,
    ...(valued.length ? [`--(?:${valued.join("|")})(?:=${value})?`] : []),
  ].join("|");

/**
 * The flags each command whose flags decide what it does may take, as regular
 * expression sources for one word; anything else turns the command down, so a
 * flag nobody thought of (`rg --hostname-bin`, `sort --compress-program`)
 * can't run a program the reviewed repository ships. A word not starting
 * with `-` is an argument. Long flags are spelled out whole: a cut-short one
 * (`--out`) isn't on the list.
 */
export const allowedFlags: Record<string, string> = {
  rg: [
    "--",
    // Not -z/--search-zip (it runs decompressors), --pre/--pre-glob or
    // --hostname-bin/--hyperlink-format, which run a program, nor --generate.
    shorts("0.abcFHhIiLlNnoPpqSsUuVvwx", "ABCdEefgjMmrTt"),
    longs(
      [
        "files", "files-with-matches", "files-without-match", "count",
        "count-matches", "type-list", "hidden", "no-ignore", "no-ignore-vcs",
        "no-ignore-parent", "no-ignore-dot", "no-ignore-global", "no-config",
        "no-heading", "heading", "line-number", "no-line-number", "column",
        "no-column", "ignore-case", "smart-case", "case-sensitive",
        "fixed-strings", "word-regexp", "line-regexp", "invert-match",
        "multiline", "multiline-dotall", "follow", "text", "null",
        "null-data", "only-matching", "vimgrep", "trim", "pcre2", "json",
        "stats", "with-filename", "no-filename", "quiet", "passthru",
        "no-messages", "crlf", "binary", "byte-offset", "one-file-system",
        "unrestricted", "glob-case-insensitive", "no-require-git", "pretty",
        "max-columns-preview", "no-unicode", "debug", "trace", "version",
        "help", "mmap", "stop-on-nonmatch", "auto-hybrid-regex",
        "ignore-file-case-insensitive", "no-ignore-exclude", "no-ignore-files",
        "no-ignore-messages", "block-buffered", "line-buffered",
        "no-context-separator", "include-zero", "sort-files", "pcre2-version",
        "no-pcre2-unicode",
        // The negations only turn a behaviour back off.
        "no-hidden", "no-follow", "no-text", "no-binary", "no-multiline",
        "no-multiline-dotall", "no-fixed-strings", "no-invert-match",
        "no-pcre2", "no-crlf", "no-mmap", "no-search-zip", "no-sort-files",
        "no-max-columns-preview", "no-glob-case-insensitive",
        "no-ignore-file-case-insensitive", "no-include-zero",
        "no-block-buffered", "no-line-buffered", "no-stats", "no-json",
        "no-trim", "no-byte-offset", "no-one-file-system",
        "no-auto-hybrid-regex", "no-encoding",
      ],
      [
        "after-context", "before-context", "context", "max-count",
        "max-depth", "glob", "iglob", "type", "type-not", "regexp", "file",
        "sort", "sortr", "color", "colors", "max-columns", "max-filesize",
        "replace", "encoding", "threads", "engine", "path-separator",
        "field-match-separator", "field-context-separator", "type-add",
        "type-clear", "ignore-file", "context-separator", "dfa-size-limit",
        "regex-size-limit",
      ],
    ),
  ].join("|"),
  // Not -o, which writes, nor --compress-program, -T or --files0-from.
  sort: [
    shorts("bcCdfghiMmnRrsuVz", "kSt"),
    longs(
      [
        "ignore-leading-blanks", "dictionary-order", "ignore-case",
        "general-numeric-sort", "human-numeric-sort", "ignore-nonprinting",
        "month-sort", "numeric-sort", "random-sort", "reverse",
        "version-sort", "unique", "stable", "merge", "zero-terminated",
        "version", "help",
      ],
      ["key", "field-separator", "buffer-size", "parallel", "sort", "check"],
    ),
  ].join("|"),
  // Not -o, which writes, nor -R, which writes a listing into each folder.
  // tree reads on through a cluster after a letter taking a value, which
  // takes the next word (-Io x out is -I x -o out), so that letter ends it.
  tree: [
    "-[acdfghilnpqstuvxACDFJNQSUX]*(?:[IP]|L\\d*)?",
    longs(
      ["noreport", "dirsfirst", "gitignore", "prune", "du", "si", "matchdirs",
        "ignore-case", "version", "help"],
      ["charset", "filelimit", "sort"],
    ),
  ].join("|"),
  // Tests and actions by name; a number like `-mtime -1` is a test's value.
  find: [
    "-\\d[\\w.+-]*",
    `-(?:${[
      "name", "iname", "path", "ipath", "wholename", "iwholename", "lname",
      "ilname", "regex", "iregex", "type", "xtype", "maxdepth", "mindepth",
      "depth", "prune", "newer", "anewer", "cnewer", "samefile", "mtime",
      "mmin", "atime", "amin", "ctime", "cmin", "size", "empty", "perm",
      "user", "group", "uid", "gid", "nouser", "nogroup", "links", "inum",
      "readable", "writable", "executable", "not", "a", "and", "o", "or",
      "true", "false", "print", "print0", "printf", "ls", "quit", "follow",
      "xdev", "mount", "H", "L", "P", "E", "X", "d", "s", "x",
    ].join("|")})`,
  ].join("|"),
};

const flagRules = Object.fromEntries(
  Object.entries(allowedFlags).map(([name, flags]) => [
    name,
    new RegExp(`^(?:${flags})$`),
  ]),
);

/** Whether every command in `command` is on Relay's list of ones that only read. */
export function readsOnly(command: string): boolean {
  const bare = command.replace(
    /(^|\s)(?:[12]?>\s*\/dev\/null|2>&1)(?=\s|$)/g,
    "$1",
  );
  // Writes, substitutions and here-documents; a quoted one counts too and
  // the command is turned down.
  if (/[<>`]|\$\(/.test(bare)) return false;
  const commands = commandsIn(bare);
  return !!commands && commands.every((c) => !!c.text && segmentReads(c));
}

/** One command of a line, as the shell reads it. */
type ShellCommand = {
  text: string;
  /** A `$` that does more than read a variable: bash's `${x@P}` and `$[x]`, zsh's `${(e)x}`. */
  expands: boolean;
  /** A word starts with an unquoted wildcard, which may expand to a file named like a flag. */
  globbed: boolean;
};

/** Wildcards bash and zsh expand at the start of a word; `{` for zsh's brace_ccl, `^` for extended_glob. */
const wildcards = "*?[{^";

/**
 * `$NAME` or `${NAME}`, which only read a variable. Not a subscript: it's
 * arithmetic, which runs code a value holds, and `$_` holds the last word.
 */
const variable = /\$(?:[A-Za-z]\w*(?![\w[])|\{[A-Za-z]\w*\})/y;

/** Whether the `$` at `at` expands more than a variable; one before a blank or the end is a `$`. */
function expandsAt(line: string, at: number, ends: string) {
  variable.lastIndex = at;
  if (variable.test(line)) return false;
  const next = line[at + 1];
  return next !== undefined && !ends.includes(next);
}

/** Whether a `$` in the double-quoted `"…"` at `open` to `close` expands more than a variable. */
function expandsQuoted(line: string, open: number, close: number) {
  for (let i = open + 1; i < close; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "$" && expandsAt(line, i, ' \t\n"')) return true;
  }
  return false;
}

/**
 * The commands of `line`, split where bash and zsh split them: a `;`, `|` or
 * newline inside quotes doesn't end one, and a backslash-newline joins two
 * lines. Undefined for what no read needs and this doesn't follow: a
 * subshell or zsh's `*(e:…:)` and `=(…)`, which run code, a command sent to
 * the background, or an unclosed quote.
 */
function commandsIn(line: string): ShellCommand[] | undefined {
  const commands: ShellCommand[] = [];
  let command: ShellCommand = { text: "", expands: false, globbed: false };
  /** Nothing of the word being read so far; empty quotes don't count. */
  let newWord = true;
  /** How far a comment has been checked for quotes, so each line is read once. */
  let commentChecked = -1;
  const endCommand = () => {
    commands.push({ ...command, text: command.text.trim() });
    command = { text: "", expands: false, globbed: false };
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    const next = line[i + 1];
    const startsWord: boolean = newWord;
    newWord = c === " " || c === "\t";
    if (c === "\n" || c === ";") {
      endCommand();
      newWord = true;
    } else if (c === "|" || c === "&") {
      const doubled = next === c;
      if (!doubled && (c === "&" || next === "&")) return undefined;
      if (doubled) i++;
      endCommand();
      newWord = true;
    } else if (c === "(" || c === ")") {
      return undefined;
    } else if (c === "\\" && next === "\n") {
      // Removed, as if the two lines were one.
      i++;
      newWord = startsWord;
    } else if (c === "\\") {
      command.text += c + (next ?? "");
      i++;
    } else if (c === "'" || c === '"' || (c === "$" && next === "'")) {
      const open = c === "$" ? i + 1 : i;
      const close = quoteEnd(line, open, open > i || c === '"');
      if (close < 0) return undefined;
      if (c === '"' && expandsQuoted(line, open, close)) command.expands = true;
      command.text += line.slice(i, close + 1);
      newWord = startsWord && close === open + 1;
      i = close;
    } else {
      // A comment where the shell has them on, words where it hasn't: a quote
      // in it would split the line differently between the two.
      if (c === "#" && startsWord && i > commentChecked) {
        const eol = line.indexOf("\n", i);
        commentChecked = eol < 0 ? line.length : eol;
        if (/['"\\]/.test(line.slice(i, commentChecked))) return undefined;
      }
      if (startsWord && wildcards.includes(c)) command.globbed = true;
      if (c === "$" && expandsAt(line, i, " \t\n;|&")) command.expands = true;
      command.text += c;
    }
  }
  endCommand();
  return commands;
}

/** Where the quote opening at `open` closes, or -1. */
function quoteEnd(line: string, open: number, escapes: boolean) {
  const quote = line[open]!;
  for (let i = open + 1; i < line.length; i++) {
    if (escapes && line[i] === "\\") i++;
    else if (line[i] === quote) return i;
  }
  return -1;
}

function segmentReads({ text: segment, expands, globbed }: ShellCommand) {
  const [name, ...args] = segment.split(/\s+/);
  if (expands) return false;
  // Their flags decide whether they write, so a flag has to be spelled plainly.
  // GNU sed reads a flag anywhere, so a quoted `'-i'` after the script still edits.
  const flagged = ["git", "sed", ...Object.keys(allowedFlags)];
  const flagHidden = globbed || disguised.test(segment);
  if (flagged.includes(name!) && flagHidden) return false;
  const flags = flagRules[name];
  if (flags) return args.every((a) => !a.startsWith("-") || flags.test(a));
  switch (name) {
    case "git":
      return gitReadsOnly(args);
    case "sed":
      return sedPrints(args);
    default:
      return plain.has(name);
  }
}

/** Where the subcommand is in `git`'s words, past `--no-pager` and `-C <dir>`. */
export function subcommandAt(args: string[]) {
  let i = 0;
  while (args[i] === "--no-pager" || args[i] === "-C")
    i += args[i] === "-C" ? 2 : 1;
  return i;
}

/** Git subcommands that run a checkout's textconv or external diff command unless told not to. */
export const diffShowing = new Set([
  "diff",
  "log",
  "show",
  "diff-tree",
  "range-diff",
  "blame",
]);

export const diffDriversOff = ["--no-textconv", "--no-ext-diff"];

const diffCommand = new RegExp(
  `(^|[\\s;&|])(git(?:\\s+(?:--no-pager|-C\\s+[^\\s;&|]+))*\\s+(?:${[...diffShowing].join("|")}))(?=[\\s;&|]|$)`,
  "g",
);

/**
 * `command` with `--no-textconv --no-ext-diff` after each git subcommand
 * that shows a diff: a checkout's own `.git/config` can name a command that
 * turns a file into text for one, or that shows the diff itself.
 */
function withoutDiffDrivers(command: string) {
  return command.replace(diffCommand, `$1$2 ${diffDriversOff.join(" ")}`);
}

/** Whether every git in `command` that shows a diff has its drivers off. */
function diffDriversOffThroughout(command: string) {
  return (commandsIn(command) ?? []).every(({ text }) => {
    const [name, ...args] = text.split(/\s+/);
    const at = subcommandAt(args);
    if (name !== "git" || !diffShowing.has(args[at]!)) return true;
    const end = args.indexOf("--");
    const options = end < 0 ? args : args.slice(0, end);
    return diffDriversOff.every((flag) => options.includes(flag));
  });
}

/** `git` with these arguments, as words after `git`, only reads. */
export function gitReadsOnly(args: string[]) {
  const [sub, ...rest] = args.slice(subcommandAt(args));
  if (
    // git takes a long flag cut short (`--open-fi`) and clustered short ones (`-lO`);
    // `--textconv` would undo a caller's `--no-textconv`, and `--filters` runs smudge filters.
    rest.some((a) => /^(--(ou|op|ext|textc|filters)|-[^-]*O)/.test(a))
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
  if (typeof command === "string" && readsOnly(command)) {
    const rewritten = withoutDiffDrivers(command);
    // A git diff the rewrite missed is turned down below.
    if (diffDriversOffThroughout(rewritten))
      return rewritten === command
        ? {}
        : {
            hookSpecificOutput: {
              hookEventName: "PreToolUse" as const,
              permissionDecision: "allow" as const,
              updatedInput: { ...tool_input, command: rewritten },
            },
          };
  }
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason:
        "This thread only reads the code. Use Read, Grep and Glob, or a plain read-only command like git diff, git log or rg, and report what should change instead of changing files.",
    },
  };
}
