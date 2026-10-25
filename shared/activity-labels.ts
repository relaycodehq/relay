// Moved from the desktop's AgentTurn so the phone app words a turn the same way.
import type { AgentActivity, TraceDropped } from "./projects";
import { askedQuestions, isQuestionCall } from "./asked-questions";
import { isStartThreads, startedIds } from "./started-threads";

export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const summaries: Record<AgentActivity["kind"], (count: number) => string> = {
  read: (n) => `Read ${plural(n, "file")}`,
  file: (n) => `Edited ${plural(n, "file")}`,
  command: (n) => `Ran ${plural(n, "command")}`,
  search: (n) => `Searched code ${plural(n, "time")}`,
  web: (n) => `Searched the web ${plural(n, "time")}`,
  agent: (n) => `Ran ${plural(n, "agent")}`,
  tool: (n) => `Used ${plural(n, "tool")}`,
};

/**
 * The files one edit call wrote. A patch over several reads "a.ts +2 more",
 * its paths one per line in `detail` when the agent says them.
 */
function editedFiles(a: AgentActivity) {
  const more = / \+(\d+) more$/.exec(a.label);
  if (!more) return [a.label];
  const paths = a.detail?.split("\n") ?? [];
  const count = Number(more[1]) + 1;
  return paths.length === count
    ? paths
    : Array.from({ length: count }, (_, i) => `${a.id}\n${i}`);
}

/**
 * "Read 3 files, ran 2 commands, and edited 1 file". `dropped` adds the
 * calls a long turn's full trace let go of.
 */
export function summarizeActivity(
  activity: AgentActivity[],
  dropped: TraceDropped = {},
) {
  const groups = new Map<AgentActivity["kind"], Set<string>>();
  const failed = new Set<string>();
  const stopped = new Set<string>();
  const running = new Set<string>();
  let questions = 0;
  let threads = 0;
  for (const a of activity) {
    if (isQuestionCall(a) && a.status === "complete") {
      questions += askedQuestions(a)?.length ?? 1;
      continue;
    }
    if (isStartThreads(a) && a.status === "complete") {
      threads += startedIds(a.detail)?.length ?? 1;
      continue;
    }
    if (a.status !== "complete") {
      (a.status === "failed"
        ? failed
        : a.status === "stopped"
          ? stopped
          : running
      ).add(a.id);
      continue;
    }
    const seen = groups.get(a.kind) ?? new Set();
    // Repeated reads or edits of one file count once; commands and tools count every call.
    if (a.kind === "file") for (const path of editedFiles(a)) seen.add(path);
    else seen.add(a.kind === "read" ? a.label : a.id);
    groups.set(a.kind, seen);
  }
  // The dropped calls came first.
  const counts = new Map<AgentActivity["kind"], number>();
  for (const [kind, n] of Object.entries(dropped))
    if (kind !== "failed" && n) counts.set(kind as AgentActivity["kind"], n);
  for (const [kind, seen] of groups)
    counts.set(kind, (counts.get(kind) ?? 0) + seen.size);
  const labels = [...counts].map(([kind, n]) => summaries[kind](n));
  if (threads) labels.push(`Started ${plural(threads, "thread")}`);
  if (questions) labels.push(`Asked you ${plural(questions, "question")}`);
  const failures = failed.size + (dropped.failed ?? 0);
  if (failures) labels.push(`${plural(failures, "tool call")} failed`);
  if (stopped.size)
    labels.push(`${plural(stopped.size, "tool call")} stopped`);
  if (running.size)
    labels.push(`${plural(running.size, "tool call")} still running`);
  const parts = labels.map((text, index) => {
    return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
  });
  if (parts.length < 3) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

const baseName = (path: string) =>
  path.split("/").filter(Boolean).at(-1) ?? path;

const commandWrappers = new Set([
  "sudo",
  "env",
  "time",
  "nice",
  "nohup",
  "exec",
  "command",
  "npx",
  "pnpx",
  "bunx",
]);

const commandSetup = new Set([
  "cd",
  "pushd",
  "popd",
  "export",
  "unset",
  "set",
  "source",
  ".",
  "true",
  "[",
  "[[",
  "test",
  "done",
  "fi",
  "esac",
  "}",
]);

// Shell grammar around the commands: `if` and `do` lead into one, while the
// headers of `for f in …` or `case $x in` run nothing themselves.
const shellLeads = new Set([
  "if",
  "elif",
  "while",
  "until",
  "then",
  "do",
  "else",
  "!",
  "{",
]);

const shellHeaders = new Set(["for", "case", "select", "function"]);

/** The program a command line is about: "cd app && npx vitest run" is
 *  vitest, and Codex's "/bin/zsh -lc 'rg foo'" is rg. */
export function programName(command: string): string | undefined {
  const shell = command.match(
    /^\s*(?:\S*\/)?(?:ba|z|fi)?sh\s+-\w*c\s+(['"])([\s\S]*)\1\s*$/,
  );
  if (shell) return programName(shell[2]!);
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    while (
      words[0] &&
      (commandWrappers.has(words[0]) ||
        shellLeads.has(words[0]) ||
        /^\w+=/.test(words[0]))
    )
      words.shift();
    const word = words[0]?.replace(/^["'(]+|["')]+$/g, "");
    if (!word || commandSetup.has(word) || shellHeaders.has(word)) continue;
    return word.split("/").at(-1) || word;
  }
}

/** The past-tense line for a finished call, e.g. "Ran rg" or "Read AgentTurn.tsx". */
export function doneLabel(a: AgentActivity) {
  if (isQuestionCall(a))
    return a.status === "complete"
      ? `Asked you ${plural(askedQuestions(a)?.length ?? 1, "question")}`
      : "Didn't get your answer";
  if (a.status === "failed") {
    switch (a.kind) {
      case "command":
        return `Failed ${programName(a.label) ?? "command"}`;
      case "read":
        return `Failed to read ${baseName(a.label)}`;
      case "file":
        return `Failed to edit ${baseName(a.label)}`;
      case "search":
        return `Search failed: ${a.label}`;
      case "web":
        return "Web search failed";
      case "agent":
        return `Agent failed: ${a.label}`;
      case "tool":
        return `Tool failed: ${a.label}`;
    }
  }
  if (a.status === "stopped") {
    switch (a.kind) {
      case "command":
        return `Stopped ${programName(a.label) ?? "command"}`;
      case "read":
        return `Stopped reading ${baseName(a.label)}`;
      case "file":
        return `Stopped editing ${baseName(a.label)}`;
      case "search":
        return `Search stopped: ${a.label}`;
      case "web":
        return "Web search stopped";
      case "agent":
        return `Agent stopped: ${a.label}`;
      case "tool":
        // Its label is still the running one, e.g. "Generating an image".
        return `Stopped: ${a.label}`;
    }
  }
  switch (a.kind) {
    case "command":
      return `Ran ${programName(a.label) ?? "command"}`;
    case "read":
      return `Read ${baseName(a.label)}`;
    case "file":
      return `Edited ${baseName(a.label)}`;
    case "search":
      return `Searched for ${a.label}`;
    case "web":
      return "Searched the web";
    case "agent":
    case "tool":
      return a.label;
  }
}

/** The present-tense line shown while a call runs, e.g. "Reading AgentTurn.tsx". */
export function liveLabel(a: AgentActivity) {
  if (isQuestionCall(a)) return "Waiting for your answer";
  switch (a.kind) {
    case "command":
      return `Running ${programName(a.label) ?? "command"}`;
    case "read":
      return `Reading ${baseName(a.label)}`;
    case "file":
      return `Editing ${baseName(a.label)}`;
    case "search":
      return `Searching for ${a.label}`;
    case "web":
      return "Searching the web";
    case "agent":
      return a.label;
    case "tool":
      return a.label;
  }
}
