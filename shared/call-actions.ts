// What a tool call did, read from its command or tool: most of the commands
// an agent runs are reads, searches and edits in disguise. The desktop works
// this out and phones get it ready-made (`AgentActivity.actions`), so the
// shell parsing lives here only.
import { isImagePath } from "./answer-images";
import type { AgentActivity, WrittenCode } from "./projects";
import {
  firstStage,
  heredocOpened,
  heredocs,
  pipedInto,
  positional,
  segments,
  unwrapShell,
  wordsOf,
  writesTo,
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

type Verdict = Extract<CallAction, { kind: "test" | "check" }>;

const isVerdict = (action: CallAction): action is Verdict => action.kind === "test" || action.kind === "check";

/** A command that failed failed its last test or check, when the output didn't say which. */
function failedByItsCall(actions: CallAction[], a: AgentActivity): CallAction[] {
  if (a.status !== "failed") return actions;
  if (actions.some((action) => isVerdict(action) && action.failed)) return actions;
  const last = actions.map(isVerdict).lastIndexOf(true);
  if (last === -1) return actions;
  return actions.map((action, i) => (i === last ? { ...action, failed: true } : action));
}

/** A whole file written is made; an edit or a patch changes part of one. */
function fileActions(a: AgentActivity): CallAction[] {
  if (a.written?.length)
    return a.written.map((w) => ({ kind: w.kind === "whole" ? "create" : "edit", file: w.path }));
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

/** Every action in a command line, in order; nothing it only set up for. */
export function commandActions(command: string, output = ""): CallAction[] {
  const { head, bodies } = heredocs(unwrapShell(command));
  let next = 0;
  const actions: CallAction[] = [];
  for (const segment of segments(head)) {
    const body = heredocOpened(segment) ? bodies[next++] : undefined;
    const action = segmentAction(segment, body);
    if (action) actions.push(action);
  }
  if (!actions.length) return [{ kind: "run", what: onlySetup(head) }];
  const severalTests = actions.filter((a) => a.kind === "test").length > 1;
  return actions.map((action) => withOutcome(action, output, severalTests));
}

/** A command that only set up, like `echo hi`, or a loop that ran nothing it could name. */
function onlySetup(head: string) {
  if (/^\s*(?:cd [^;&]+(?:&&|;)\s*)*.*\bfor\b/.test(head)) return "shell loop";
  return wordsOf(segments(head)[0] ?? "")[0] ?? "command";
}

/** The command as you'd retype it: no shell wrapper, no `cd`, no `| head`, no heredoc body. */
export function shownCommand(command: string) {
  const { head } = heredocs(unwrapShell(command));
  const first = segments(head).find((s) => segmentAction(s, "") !== undefined);
  return (first ? firstStage(first).replace(redirect, "") : head.split("\n")[0]!).trim();
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

function segmentAction(segment: string, body: string | undefined): CallAction | undefined {
  // `b=$(git merge-base HEAD main)` only works out a value for what comes next.
  const assigned = /^\s*\w+=\$\((?:[^()]|\([^()]*\))*\)\s*/.exec(segment);
  if (assigned) {
    const rest = segment.slice(assigned[0].length);
    return rest ? segmentAction(rest, body) : undefined;
  }
  const [program, ...args] = pastLeads(subshellOff(segment, wordsOf(firstStage(segment).replace(redirect, ""))));
  if (!program || setup.has(program)) return undefined;
  switch (program) {
    case "sed":
      return sedAction(args);
    case "nl":
      return nlAction(segment, args);
    case "cat":
      return catAction(segment, args, body);
    case "tee": {
      const file = positional(args)[0];
      return body !== undefined && file ? { kind: "create", file } : undefined;
    }
    case "grep":
    case "rg":
      return searchCommand(program, args);
    case "git":
      return gitAction(segment, args, body);
    case "vitest":
      return { kind: "test", target: positional(args.slice(1))[0], failed: false };
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
      return { kind: "run", what: baseName(positional(args).at(-1) ?? program) };
    default:
      return { kind: "run", what: baseName(program) };
  }
}

/** The lines `sed -n 10,40p` prints: "10–40". */
function printedLines(args: string[]) {
  const range = /^(\d+),(\d+)p$/.exec(args.find((a) => /^\d+,\d+p$/.test(a)) ?? "");
  return range ? `${range[1]}–${range[2]}` : undefined;
}

const readOf = (file: string, lines: string | undefined): CallAction =>
  lines ? { kind: "read", file, lines } : { kind: "read", file };

/** `sed -n 10,40p file` reads lines; `sed -i` edits. */
function sedAction(args: string[]): CallAction {
  const file = positional(args).at(-1) ?? "";
  if (args.some((a) => a.startsWith("-i"))) return { kind: "edit", file };
  return readOf(file, printedLines(args));
}

/** `nl -ba file | sed -n 40,90p` reads those lines with their numbers. */
function nlAction(segment: string, args: string[]): CallAction {
  const file = positional(args)[0] ?? "";
  return readOf(file, printedLines(wordsOf(pipedInto(segment) ?? "")));
}

/** `cat > f <<EOF` writes f, `cat <<EOF | node` runs node, `cat f` reads f. */
function catAction(segment: string, args: string[], body: string | undefined): CallAction | undefined {
  const target = writesTo(segment);
  if (target && body !== undefined) return { kind: "create", file: target };
  const piped = pipedInto(firstStage(segment));
  if (piped) return segmentAction(piped, body);
  const file = positional(args)[0];
  return file ? { kind: "read", file } : undefined;
}

function searchCommand(program: string, args: string[]): CallAction {
  if (args[0] === "--version" || args[0] === "--help") return { kind: "run", what: `${program} ${args[0]}` };
  // A flag's value, like -A 8, isn't the pattern; -e's is, and then every other word is a path.
  const valued = /^-[ABCmegf]$|^--(?:context|max-count|glob|type|include|exclude|regexp)$/;
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
  const message = /\s-\w*m\s+(["'])((?:(?!\1)[^\n])*)/.exec(segment)?.[2] ?? "";
  const fromStdin = args.some((a, i) => (a === "-F" || a === "--file") && args[i + 1] === "-");
  const fromHeredoc = message.startsWith("$(cat") || fromStdin;
  if (!fromHeredoc || body === undefined) return message;
  return body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

/** `npm test` tests, `npm run lint` checks; `npm install` or `npm run dev` only runs. */
function packageScript(program: string, args: string[]): CallAction {
  const script = (args[0] === "run" ? args[1] : args[0]) ?? "";
  if (/^(?:test|t|vitest|jest)(?::|$)/.test(script)) return { kind: "test", failed: false };
  if (/^(?:lint|typecheck|check|format|tsc|types)(?::|$)/.test(script)) return { kind: "check", name: script, failed: false };
  return { kind: "run", what: `${program} ${script}`.trim() };
}

/** A script that reads a file, changes it and writes it back is an edit of that file; one run from a file is named by it. */
function scriptAction(program: string, args: string[], body: string | undefined): CallAction {
  const inline = args.some((a) => /^-[ec]$|^--eval$/.test(a));
  const script = positional(args)[0];
  if (body === undefined && !inline && script) return { kind: "run", what: baseName(script) };
  const file = body && /\bp\s*=\s*["']([^"']+)["']/.exec(body)?.[1];
  // Labels are cut, so the write at the end may be gone; a replace says enough.
  const changesIt = body && /open\(p,\s*["']w["']\)|\.write(?:_text)?\(|\.replace\(/.test(body);
  return file && changesIt ? { kind: "edit", file } : { kind: "run", what: `${program} script` };
}

const failedTests = /\bFAIL\b|Failed Tests|×|\b[1-9]\d* failed/;
const failedChecks = /^tc [1-9]|error TS\d+|^npm (?:ERR!|error)|✖ \d+ problems?|Code style issues found/m;

/** What only the output says: a test run's result, a commit's hash. */
function withOutcome(action: CallAction, output: string, severalTests: boolean): CallAction {
  switch (action.kind) {
    case "test":
      return { ...action, failed: testFailed(action.target, output, severalTests) };
    case "check":
      return { ...action, failed: failedChecks.test(output) };
    case "commit": {
      // `git commit` prints "[branch abc1234] subject", `git log --oneline` "abc1234 subject".
      const found = /^(?:\[\S+\s+([0-9a-f]{7,40})\]|([0-9a-f]{7,40}))\s/m.exec(output);
      const hash = found?.[1] ?? found?.[2];
      return hash ? { ...action, hash } : action;
    }
    default:
      return action;
  }
}

/** With several test runs in one command, each is judged by the failures that name its file. */
function testFailed(target: string | undefined, output: string, severalTests: boolean) {
  if (!severalTests || !target) return failedTests.test(output);
  const name = baseName(target);
  return output.split("\n").some((line) => failedTests.test(line) && line.includes(name));
}

/** Files a command writes from a heredoc: `cat > f <<EOF`, `cat <<EOF > f`, `tee f <<EOF`. */
export function writtenByCommand(command: string): WrittenCode[] {
  const { head, bodies } = heredocs(unwrapShell(command));
  let next = 0;
  const files: WrittenCode[] = [];
  for (const segment of segments(head)) {
    if (!heredocOpened(segment)) continue;
    const body = bodies[next++];
    const action = body === undefined ? undefined : segmentAction(segment, body);
    if (action?.kind === "create") files.push({ kind: "whole", path: action.file, content: body! });
  }
  return capWritten(files);
}

export const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

/** Scratch files an agent writes for itself, outside any project. */
export const isScratch = (path: string) => /^\/(?:private\/)?tmp\//.test(path);
