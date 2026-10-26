// What a tool call did, read from its command or tool: most of the commands
// an agent runs are reads, searches and edits in disguise. The desktop works
// this out and phones get it ready-made (`AgentActivity.actions`), so the
// shell parsing lives here only.
import { isImagePath } from "./answer-images";
import type { AgentActivity, WrittenCode } from "./projects";
import { actionsThatRan, failedByItsCall, outcomes, type Step } from "./call-verdicts";
import {
  baseName,
  chain,
  firstStage,
  heredocOpened,
  heredocs,
  pipedInto,
  positional,
  segments,
  unwrapShell,
  wordsOf,
  writesTo,
  type Joiner,
} from "./shell-words";
import { capWritten } from "./written-code";

export type CallAction =
  | { kind: "read"; file: string; lines?: string }
  | { kind: "image"; file: string }
  | { kind: "search"; pattern: string; where?: string }
  | { kind: "edit"; file: string }
  | { kind: "create"; file: string }
  | { kind: "test"; target?: string; failed: boolean }
  | { kind: "check"; name: string; failed: boolean }
  | { kind: "commit"; hash?: string; subject: string }
  | { kind: "git"; what: string }
  | { kind: "run"; what: string }
  | { kind: "web"; query: string }
  /** Anything with a row of its own: agents, questions, MCP tools. */
  | { kind: "tool" };

/** Calls are read again on every render; a call's object is replaced when it changes. */
const read = new WeakMap<AgentActivity, CallAction[]>();

/** What a call did; phones get it from the desktop, which reads it here. */
export function callActions(a: AgentActivity): CallAction[] {
  if (a.actions) return a.actions;
  const known = read.get(a);
  if (known) return known;
  const actions = failedByItsCall(actionsOf(a), a);
  read.set(a, actions);
  return actions;
}

function actionsOf(a: AgentActivity): CallAction[] {
  switch (a.kind) {
    case "read":
      return [isImagePath(a.label) ? { kind: "image", file: a.label } : { kind: "read", file: a.label }];
    case "file":
      return fileActions(a);
    case "search":
      return [searchAction(a.label)];
    case "web":
      return [{ kind: "web", query: a.label }];
    case "command":
      return commandActions(a.label, a.detail ?? "");
    default:
      return [{ kind: "tool" }];
  }
}

/** A whole file written is made, unless the tool said it was there already; an edit or a patch changes part of one. */
function fileActions(a: AgentActivity): CallAction[] {
  if (a.written?.length) {
    // Claude's Write over an existing file answers as its Edit does.
    const overwrote = /^The file .+ has been updated/.test(a.detail ?? "");
    return a.written.map((w) => ({ kind: w.kind === "whole" && !overwrote ? "create" : "edit", file: w.path }));
  }
  const made = /^File created successfully/.test(a.detail ?? "");
  return filesNamed(a).map((file) => ({ kind: made ? "create" : "edit", file }));
}

/** "a.ts +2 more" lists every path in its detail; any other detail is output. */
function filesNamed(a: AgentActivity): string[] {
  const more = /^(.*)\s\+(\d+) more$/.exec(a.label);
  const lines = a.detail?.split("\n") ?? [];
  const listsThem = more && lines.length === Number(more[2]) + 1 && lines[0] === more[1];
  return listsThem ? lines : [a.label];
}

/** Claude's Grep and Glob read "pattern in path". */
function searchAction(label: string): CallAction {
  const at = label.lastIndexOf(" in ");
  return at > 0
    ? { kind: "search", pattern: label.slice(0, at), where: label.slice(at + 4) }
    : { kind: "search", pattern: label };
}

/** Setup around the work: moving about, echoing separators, making folders. */
const setup = new Set(["cd", "echo", "mkdir", "true", "export", "wc", "pushd", "popd", "for", "done", "fi"]);
/** Words that lead into the command after them. */
const leads = new Set(["npx", "sudo", "do", "then", "else", "if", "!", "time", "env"]);
/** `2>&1`, `>/dev/null`, `> /tmp/out.txt`; not a `>` inside a quoted message. */
const redirect = /\s\d?>\s*(?:&\d|\/\S*)/g;

/** Every action in a command line that ran, in order; nothing it only set up for. */
export function commandActions(command: string, output = ""): CallAction[] {
  const { head, bodies } = heredocs(unwrapShell(command));
  let next = 0;
  const steps: Step[] = [];
  for (const { segment, joinedBy } of chain(head)) {
    const body = heredocOpened(segment) ? bodies[next++] : undefined;
    steps.push({ actions: segmentActions(segment, body), joinedBy });
  }
  const actions = steps.flatMap((step) => step.actions);
  if (!actions.length) return [{ kind: "run", what: onlySetup(head) }];
  const judge = outcomes(actions, output);
  return actionsThatRan(steps.map((step) => ({ ...step, actions: step.actions.map(judge) })));
}

/** A command that only set up, like `echo hi`, or a loop that ran nothing it could name. */
function onlySetup(head: string) {
  const commands = segments(head);
  if (commands.some((segment) => wordsOf(segment)[0] === "for")) return "shell loop";
  return wordsOf(commands[0] ?? "")[0] ?? "command";
}

/** The command as you'd retype it: no shell wrapper, no `cd` or `echo`, no `| head`, no heredoc body. */
export function shownCommand(command: string) {
  const { head } = heredocs(unwrapShell(command));
  let shown = "";
  // What joined the commands left out between two shown ones.
  let between: Joiner[] = [];
  for (const { segment, joinedBy } of chain(head)) {
    if (joinedBy) between.push(joinedBy);
    if (!segmentActions(segment, "").length) continue;
    const text = firstStage(segment).replace(redirect, "").trim();
    shown += shown ? `${joinedAs(loosest(between))}${text}` : text;
    between = [];
  }
  return shown || head.split("\n")[0]!.trim();
}

/**
 * How two shown commands relate past the ones left out between them:
 * `npm test; cd sub && npm run lint` runs the lint whatever the tests did.
 */
function loosest(joiners: Joiner[]) {
  if (joiners.includes("\n")) return "\n";
  if (joiners.includes(";")) return ";";
  return joiners.at(-1);
}

function joinedAs(joiner: Joiner | undefined) {
  if (joiner === "\n") return "\n";
  return joiner === "&&" || joiner === "||" ? ` ${joiner} ` : "; ";
}

/** `timeout`'s flags that take a value, so the value isn't read as the duration. */
const timeoutValued = new Set(["-s", "-k", "--signal", "--kill-after"]);

/** `(cd app && npm test)` splits into `(cd app` and `npm test)`: the brackets stick to the words beside them. */
function subshellOff(segment: string, words: string[]) {
  const opened = segment.split("(").length - 1;
  const closed = segment.split(")").length - 1;
  const last = words.length - 1;
  if (opened > closed && words[0]?.startsWith("(")) words[0] = words[0].slice(1);
  if (closed > opened && words[last]?.endsWith(")")) words[last] = words[last]!.slice(0, -1);
  return words;
}

/** The words from the program on: past env settings, leads like `sudo`, and `timeout 60`. */
function pastLeads(words: string[]) {
  for (;;) {
    const word = words[0];
    if (word === undefined) return words;
    if (word === "" || /^\w+=/.test(word) || leads.has(word)) words.shift();
    else if (word === "timeout") {
      words.shift();
      while (words[0]?.startsWith("-")) if (timeoutValued.has(words.shift()!)) words.shift();
      words.shift();
    } else return words;
  }
}

/** What one command of a line did: nothing when it only set up, a read of each file `cat a b` printed. */
function segmentActions(segment: string, body: string | undefined): CallAction[] {
  // `b=$(git merge-base HEAD main)` only works out a value for what comes next.
  const assigned = /^\s*\w+=\$\((?:[^()]|\([^()]*\))*\)\s*/.exec(segment);
  if (assigned) {
    const rest = segment.slice(assigned[0].length);
    return rest ? segmentActions(rest, body) : [];
  }
  const [program, ...args] = pastLeads(subshellOff(segment, wordsOf(firstStage(segment).replace(redirect, ""))));
  if (!program || setup.has(program)) return [];
  if (program === "cat") return catActions(segment, args, body);
  const action = programAction(program, args, segment, body);
  return action ? [action] : [];
}

function programAction(program: string, args: string[], segment: string, body: string | undefined): CallAction | undefined {
  switch (program) {
    case "sed":
      return sedAction(args);
    case "nl":
      return nlAction(segment, args);
    case "tee": {
      const file = positional(args)[0];
      if (body === undefined || !file) return undefined;
      return { kind: args.includes("-a") || args.includes("--append") ? "edit" : "create", file };
    }
    case "grep":
    case "rg":
      return searchCommand(program, args);
    case "git":
      return gitAction(segment, args, body);
    case "vitest":
      return vitestAction(args);
    case "npm":
    case "pnpm":
    case "yarn":
      return packageScript(program, args);
    case "python3":
    case "python":
    case "node":
      return scriptAction(program, args, body);
    case "sh":
    case "bash":
    case "zsh":
    case "tsx":
      if (/^-\w*c$/.test(args[0] ?? "")) return { kind: "run", what: "shell snippet" };
      // The script is the first word after the flags; the rest are its arguments.
      return { kind: "run", what: baseName(positional(args)[0] ?? program) };
    default:
      return { kind: "run", what: baseName(program) };
  }
}

/** The lines `sed -n 10,40p` prints: "10–40". */
function printedLines(args: string[]) {
  const range = /^(\d+),(\d+)p$/.exec(args.find((a) => /^\d+,\d+p$/.test(a)) ?? "");
  return range ? `${range[1]}–${range[2]}` : undefined;
}

/** The lines a read piped into `sed -n 10,40p` or `head -n 50` kept: "10–40", "1–50". */
function pipedLines(segment: string) {
  const words = wordsOf(pipedInto(segment) ?? "");
  if (words[0] === "sed") return printedLines(words);
  if (words[0] !== "head") return undefined;
  const [flag = "", value = ""] = words.slice(1);
  const count = /^-n?(\d+)$/.exec(flag)?.[1] ?? (flag === "-n" && /^\d+$/.test(value) ? value : undefined);
  return count ? `1–${count}` : undefined;
}

const readOf = (file: string, lines: string | undefined): CallAction =>
  lines ? { kind: "read", file, lines } : { kind: "read", file };

/** Flags that hand sed its script, so no word after the flags is. */
const sedScript = /^-[ef]$|^--(?:expression|file)$/;

/** `sed -n 10,40p file` reads lines; `sed -i` edits. Without a file it only trims what came in. */
function sedAction(args: string[]): CallAction {
  const words = positional(args).filter((a) => !sedScript.test(args[args.indexOf(a) - 1] ?? ""));
  const files = args.some((a) => sedScript.test(a)) ? words : words.slice(1);
  const file = files.at(-1);
  if (!file) return { kind: "run", what: "sed" };
  if (args.some((a) => a.startsWith("-i"))) return { kind: "edit", file };
  return readOf(file, printedLines(args));
}

/** `nl -ba file | sed -n 40,90p` reads those lines with their numbers. */
function nlAction(segment: string, args: string[]): CallAction {
  const file = positional(args)[0] ?? "";
  return readOf(file, pipedLines(segment));
}

/**
 * `cat > f <<EOF` writes f, `cat >> f <<EOF` adds to it, `cat <<EOF | node`
 * runs node, `cat f | head` reads f, `cat a b` reads both.
 */
function catActions(segment: string, args: string[], body: string | undefined): CallAction[] {
  const target = writesTo(segment);
  if (target && body !== undefined) return [{ kind: target.appends ? "edit" : "create", file: target.path }];
  const piped = pipedInto(firstStage(segment));
  if (piped) return segmentActions(piped, body);
  const files = positional(args);
  // Lines kept from what several files printed together aren't any one file's.
  const lines = files.length === 1 ? pipedLines(segment) : undefined;
  return files.map((file) => readOf(file, lines));
}

/**
 * Flags whose value is the next word, like -A 8 or rg's -t ts. rg and grep
 * differ: grep's -E and -r take none, rg's take an encoding and a replacement.
 */
const valuedFlags = {
  grep: /^-[ABCmefdD]$|^--(?:context|max-count|include|exclude|exclude-dir|regexp|file|directories|devices|label|color|colour)$/,
  rg: /^-[ABCmegftTjMEdr]$|^--(?:context|max-count|glob|iglob|type|type-not|type-add|type-clear|regexp|file|threads|max-depth|max-columns|max-filesize|encoding|replace|sort|sortr|colors|color|pre|pre-glob|context-separator|field-match-separator|path-separator|engine|ignore-file)$/,
};

function searchCommand(program: "grep" | "rg", args: string[]): CallAction {
  if (args[0] === "--version" || args[0] === "--help") return { kind: "run", what: `${program} ${args[0]}` };
  // A flag's value isn't the pattern; -e's is, and then every other word is a path.
  const valued = valuedFlags[program];
  const given = args.flatMap((a, i) => {
    if (a === "-e" || a === "--regexp") return [args[i + 1] ?? ""];
    return a.startsWith("--regexp=") ? [a.slice("--regexp=".length)] : [];
  });
  const words = args.filter((a, i) => !a.startsWith("-") && !valued.test(args[i - 1] ?? ""));
  const [pattern = "", ...where] = given.length ? [given.join(" | "), ...words] : words;
  return { kind: "search", pattern, ...(where.length ? { where: where.join(" ") } : {}) };
}

function gitAction(segment: string, args: string[], body: string | undefined): CallAction | undefined {
  const sub = gitSubcommand(args);
  if (sub === "add") return undefined;
  if (sub === "grep") return gitGrep(args.slice(args.indexOf("grep") + 1));
  if (sub !== "commit") return { kind: "git", what: `git ${sub}`.trim() };
  return { kind: "commit", subject: commitSubject(segment, args, body) };
}

/** `git grep -n "x" HEAD -- src` searches src: a revision before `--` isn't a place. */
function gitGrep(args: string[]): CallAction {
  const split = args.indexOf("--");
  const head = split === -1 ? args : args.slice(0, split);
  // A flag's value isn't the pattern; -e's is.
  const valued = /^-[ABCm]$|^--(?:context|max-count|max-depth)$/;
  const given = head.flatMap((a, i) => (a === "-e" ? [head[i + 1] ?? ""] : []));
  const words = head.filter((a, i) => {
    const before = head[i - 1] ?? "";
    return !a.startsWith("-") && !valued.test(before) && before !== "-e";
  });
  const [pattern = "", ...rest] = given.length ? [given.join(" | "), ...words] : words;
  // Without `--`, a word with a slash or a dot is a path, anything else a revision.
  const places = split === -1 ? rest.filter((w) => /[/.]/.test(w)) : args.slice(split + 1);
  return { kind: "search", pattern, ...(places.length ? { where: places.join(" ") } : {}) };
}

/** The word after git's own options: `git -C app -c k=v status` is a status. */
function gitSubcommand(args: string[]) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" || args[i] === "-c") i++;
    else if (!args[i]!.startsWith("-")) return args[i]!;
  }
  return "";
}

/** `-m "subject"`, or the first line of the heredoc that `-m "$(cat <<EOF` or `-F -` reads it from. */
function commitSubject(segment: string, args: string[], body: string | undefined) {
  // Read off the raw text: a cut-off label leaves the message's quote open.
  const quoted = /\s-\w*m\s+(?:"((?:\\.|[^"\\\n])*)|'([^'\n]*))/.exec(segment);
  // Inside double quotes \" is a quote; inside single quotes a backslash is just one.
  const message = quoted?.[1]?.replace(/\\(["\\$`])/g, "$1") ?? quoted?.[2] ?? "";
  const fromStdin = args.some((a, i) => (a === "-F" || a === "--file") && args[i + 1] === "-");
  const fromHeredoc = message.startsWith("$(cat") || fromStdin;
  if (!fromHeredoc || body === undefined) return message;
  return body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/** `vitest run a.test.ts`, or `vitest a.test.ts`, which watches but in an agent's shell runs once. */
function vitestAction(args: string[]): CallAction {
  const words = positional(args);
  const target = /^(?:run|watch|related|dev)$/.test(words[0] ?? "") ? words[1] : words[0];
  return target ? { kind: "test", target, failed: false } : { kind: "test", failed: false };
}

/**
 * `npm test` tests, `npm run lint` checks; `npm install` or `npm run dev`
 * only runs, and so do `format` and `lint:fix`, which change files rather
 * than pass or fail.
 */
function packageScript(program: string, args: string[]): CallAction {
  const script = (args[0] === "run" ? args[1] : args[0]) ?? "";
  if (/^(?:test|t|vitest|jest)(?::|$)/.test(script)) return { kind: "test", failed: false };
  const fixes = /^format$|:(?:fix|write)$/.test(script) || args.some((a) => a === "--fix" || a === "--write");
  if (!fixes && /^(?:lint|typecheck|check|format|tsc|types)(?::|$)/.test(script)) return { kind: "check", name: script, failed: false };
  return { kind: "run", what: `${program} ${script}`.trim() };
}

/** A script that reads a file, changes it and writes it back is an edit of that file; one run from a file is named by it. */
function scriptAction(program: string, args: string[], body: string | undefined): CallAction {
  const inline = args.some((a) => /^-[ec]$|^--eval$/.test(a));
  const script = positional(args)[0];
  if (body === undefined && !inline && script) return { kind: "run", what: baseName(script) };
  const file = body && /\bp\s*=\s*["']([^"']+)["']/.exec(body)?.[1];
  // Labels are cut, so the write at the end may be gone; a replace kept for writing back says enough.
  const changesIt = body && /open\(p,\s*["']w["']\)|\.write(?:_text)?\(|\b(\w+)\s*=\s*\1\.replace\(/.test(body);
  return file && changesIt ? { kind: "edit", file } : { kind: "run", what: `${program} script` };
}

/** Files a command writes from a heredoc: `cat > f <<EOF`, `cat <<EOF > f`, `tee f <<EOF`; `cat >> f` adds the body. */
export function writtenByCommand(command: string): WrittenCode[] {
  const { head, bodies } = heredocs(unwrapShell(command));
  let next = 0;
  const files: WrittenCode[] = [];
  for (const segment of segments(head)) {
    if (!heredocOpened(segment)) continue;
    const body = bodies[next++];
    const [action] = body === undefined ? [] : segmentActions(segment, body);
    if (action?.kind === "create") files.push({ kind: "whole", path: action.file, content: body! });
    if (action?.kind === "edit" && isAppend(segment))
      files.push({ kind: "swap", path: action.file, edits: [{ old: "", new: body! }] });
  }
  return capWritten(files);
}

const isAppend = (segment: string) => writesTo(segment)?.appends || /\btee\s+(?:-a|--append)\b/.test(segment);

/** Scratch files an agent writes for itself, outside any project. */
export const isScratch = (path: string) => /^\/(?:private\/)?tmp\//.test(path);
