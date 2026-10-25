// What a tool call did, read from its command or tool: most of the commands
// an agent runs are reads, searches and edits in disguise. The desktop works
// this out and phones get it ready-made (`AgentActivity.actions`), so the
// shell parsing lives here only.
import type { AgentActivity, WrittenCode } from "./projects";

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

/** What a call did; phones get it from the desktop, which reads it here. */
export function callActions(a: AgentActivity): CallAction[] {
  if (a.actions) return a.actions;
  switch (a.kind) {
    case "read":
      return [isPicture(a.label) ? { kind: "image", file: a.label } : { kind: "read", file: a.label }];
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

const isPicture = (path: string) => /\.(png|jpe?g|gif|webp)$/i.test(path);

/** A Write makes the whole file; an Edit or a patch changes part of one. */
function fileActions(a: AgentActivity): CallAction[] {
  const paths = a.written?.length
    ? a.written.map((w) => w.path)
    : /\s\+\d+ more$/.test(a.label) && a.detail
      ? a.detail.split("\n")
      : [a.label];
  const wroteWhole =
    a.written?.every((w) => w.kind === "whole") ||
    /^File created successfully/.test(a.detail ?? "");
  return paths.map((file) => ({ kind: wroteWhole ? "create" : "edit", file }));
}

/** Claude's Grep and Glob read "pattern in path". */
function searchAction(label: string): CallAction {
  const at = label.lastIndexOf(" in ");
  return at > 0
    ? { kind: "search", pattern: label.slice(0, at), where: label.slice(at + 4) }
    : { kind: "search", pattern: label };
}

/** Programs that only trim what the one before them printed. */
const filters = new Set(["head", "tail", "cut", "sort", "uniq", "wc", "awk", "grep", "sed", "tr"]);
/** Setup around the work: moving about, echoing separators, making folders. */
const setup = new Set(["cd", "echo", "mkdir", "true", "export", "wc", "pushd", "popd", "for", "done", "fi"]);
/** Words that lead into the command after them. */
const leads = new Set(["npx", "sudo", "do", "then", "else", "if", "!", "time", "env"]);
/** `2>&1`, `>/dev/null`, `> /tmp/out.txt`; not a `>` inside a quoted message. */
const redirect = /\s\d?>\s*(?:&\d|\/\S*)/g;

/** Every action in a command line, in order; nothing it only set up for. */
export function commandActions(command: string, output = ""): CallAction[] {
  const { head, bodies } = heredocs(command);
  let next = 0;
  const actions: CallAction[] = [];
  for (const segment of segments(head)) {
    const body = /<</.test(segment) ? bodies[next++] : undefined;
    const action = segmentAction(segment, body);
    if (action) actions.push(withOutcome(action, output));
  }
  // A loop, or a label cut off mid-word, can leave nothing recognisable.
  if (!actions.length) actions.push({ kind: "run", what: /\bfor\b/.test(head) ? "shell loop" : "command" });
  return actions;
}

/** The command as you'd retype it: no `cd`, no `| head`, no heredoc body. */
export function shownCommand(command: string) {
  const { head } = heredocs(command);
  const first = segments(head).find((s) => segmentAction(s, "") !== undefined);
  return (first ? firstStage(first).replace(redirect, "") : head.split("\n")[0]!).trim();
}

function segmentAction(segment: string, body: string | undefined): CallAction | undefined {
  const words = wordsOf(firstStage(segment).replace(redirect, ""));
  while (words[0] && (/^\w+=/.test(words[0]) || leads.has(words[0]))) words.shift();
  const [program, ...args] = words;
  if (!program || setup.has(program)) return undefined;
  const writesTo = /(?:^|\s)>\s*([^\s&|;]+)/.exec(segment)?.[1];
  switch (program) {
    case "sed":
      return sedAction(args);
    case "cat":
      if (writesTo && body !== undefined) return { kind: "create", file: writesTo };
      return { kind: "read", file: positional(args)[0] ?? "" };
    case "tee":
      return body !== undefined && args[0] ? { kind: "create", file: positional(args)[0]! } : undefined;
    case "grep":
    case "rg":
      return searchCommand(program, args);
    case "git":
      return gitAction(segment, args);
    case "vitest":
      return { kind: "test", target: positional(args.slice(1))[0], failed: false };
    case "npm":
    case "pnpm":
    case "yarn":
      if (args[0] === "test") return { kind: "test", failed: false };
      return { kind: "check", name: args[0] === "run" ? (args[1] ?? "script") : (args[0] ?? program), failed: false };
    case "python3":
    case "python":
    case "node":
      return scriptAction(program, body);
    case "sh":
    case "bash":
    case "zsh":
    case "tsx": {
      if (args[0] === "-c" || args[0] === "-lc") return { kind: "run", what: "shell snippet" };
      return { kind: "run", what: baseName(positional(args).at(-1) ?? program) };
    }
    default:
      return { kind: "run", what: baseName(program) };
  }
}

/** `sed -n 10,40p file` reads lines; `sed -i` edits. */
function sedAction(args: string[]): CallAction {
  const file = positional(args).at(-1) ?? "";
  if (args.some((a) => a.startsWith("-i"))) return { kind: "edit", file };
  const range = /^(\d+),(\d+)p$/.exec(args.find((a) => /^\d+,\d+p$/.test(a)) ?? "");
  return range ? { kind: "read", file, lines: `${range[1]}–${range[2]}` } : { kind: "read", file };
}

function searchCommand(program: string, args: string[]): CallAction {
  if (args[0] === "--version" || args[0] === "--help") return { kind: "run", what: `${program} ${args[0]}` };
  // A flag's value, like -A 8, isn't the pattern.
  const valued = /^-[ABCmegf]$|^--(?:context|max-count|glob|type|include|exclude)$/;
  const words = args.filter((a, i) => !a.startsWith("-") && !valued.test(args[i - 1] ?? ""));
  const [pattern = "", ...where] = words;
  return { kind: "search", pattern, ...(where.length ? { where: where.join(" ") } : {}) };
}

function gitAction(segment: string, args: string[]): CallAction | undefined {
  const sub = args.find((a) => !a.startsWith("-")) ?? "";
  if (sub === "add") return undefined;
  if (sub !== "commit") return { kind: "git", what: `git ${sub}`.trim() };
  // Read off the raw text: a cut-off label leaves the message's quote open.
  const message = /\s-\w*m\s+(["'])((?:(?!\1)[^\n])*)/.exec(segment)?.[2] ?? "";
  return { kind: "commit", subject: message };
}

/** A script that reads a file, changes it and writes it back is an edit of that file. */
function scriptAction(program: string, body: string | undefined): CallAction {
  const file = body && /\bp\s*=\s*["']([^"']+)["']/.exec(body)?.[1];
  // Labels are cut, so the write at the end may be gone; a replace says enough.
  const changesIt = body && /open\(p,\s*["']w["']\)|\.write(?:_text)?\(|\.replace\(|open\(p\)\.read\(\)/.test(body);
  return file && changesIt ? { kind: "edit", file } : { kind: "run", what: `${program} script` };
}

/** What only the output says: a test run's result, a commit's hash. */
function withOutcome(action: CallAction, output: string): CallAction {
  switch (action.kind) {
    case "test":
      return { ...action, failed: /\bFAIL\b|Failed Tests|×|\d+ failed/.test(output) };
    case "check":
      return { ...action, failed: /^tc [1-9]|error TS\d+|npm ERR!/m.test(output) };
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

/** Splits on ; && || and newlines, minding quotes. */
function segments(line: string) {
  const out: string[] = [];
  let quote = "";
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = "";
      current += c;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    const pair = line.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      out.push(current);
      current = "";
      i++;
    } else if (c === ";" || c === "\n") {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Words with their quotes taken off. */
function wordsOf(segment: string) {
  return [...segment.matchAll(/'([^']*)'|"((?:\\.|[^"])*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

const positional = (args: string[]) => args.filter((a) => !a.startsWith("-"));

/** The first stage of a pipeline: what comes after `|` only trims its output. */
function firstStage(segment: string) {
  let quote = "";
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "|" && segment[i + 1] !== "|") {
      const next = segment.slice(i + 1).trim().split(/\s+/)[0]!;
      if (filters.has(next)) return segment.slice(0, i).trim();
    }
  }
  return segment;
}

/** The command without its heredoc bodies, which come back by order. */
function heredocs(command: string) {
  const lines = command.split("\n");
  const head: string[] = [];
  const bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    head.push(lines[i]!);
    const doc = /<<-?\s*['"]?(\w+)['"]?/.exec(lines[i]!);
    if (!doc) continue;
    const end = lines.findIndex((l, j) => j > i && l.trim() === doc[1]);
    const stop = end === -1 ? lines.length : end;
    bodies.push(lines.slice(i + 1, stop).join("\n"));
    i = stop;
  }
  return { head: head.join("\n"), bodies };
}

/** Characters of written code a call keeps, all files together. */
export const writtenLimit = 16_000;

/** Fits what a call wrote into `writtenLimit`, cutting the end off. */
export function capWritten(files: WrittenCode[]): WrittenCode[] {
  let room = writtenLimit;
  const kept: WrittenCode[] = [];
  for (const file of files) {
    if (room <= 0) break;
    const cut = (text: string) => {
      const piece = text.slice(0, Math.max(0, room));
      room -= piece.length;
      return piece;
    };
    const size = writtenSize(file);
    if (file.kind === "whole") kept.push({ ...file, content: cut(file.content) });
    else if (file.kind === "patch") kept.push({ ...file, diff: cut(file.diff) });
    else kept.push({ ...file, edits: file.edits.map((e) => ({ old: cut(e.old), new: cut(e.new) })) });
    if (writtenSize(kept.at(-1)!) < size) kept[kept.length - 1] = { ...kept.at(-1)!, cut: true };
  }
  return kept;
}

const writtenSize = (file: WrittenCode) =>
  file.kind === "whole"
    ? file.content.length
    : file.kind === "patch"
      ? file.diff.length
      : file.edits.reduce((n, e) => n + e.old.length + e.new.length, 0);

/** Files a command writes from a heredoc: `cat > f <<EOF`, `cat <<EOF > f`, `tee f <<EOF`. */
export function writtenByCommand(command: string): WrittenCode[] {
  const { head, bodies } = heredocs(command);
  let next = 0;
  const files: WrittenCode[] = [];
  for (const segment of segments(head)) {
    if (!/<</.test(segment)) continue;
    const body = bodies[next++];
    const action = body === undefined ? undefined : segmentAction(segment, body);
    if (action?.kind === "create") files.push({ kind: "whole", path: action.file, content: body! });
  }
  return capWritten(files);
}

export const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;

/** Scratch files an agent writes for itself, outside any project. */
export const isScratch = (path: string) => /^\/(?:private\/)?tmp\//.test(path);
