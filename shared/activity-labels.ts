// Moved from the desktop's AgentTurn so the phone app words a turn the same way.
import type { AgentActivity } from "./projects";

export function duration(ms: number) {
  const seconds = Math.max(0, ms / 1000);
  return seconds < 10
    ? `${seconds.toFixed(1)}s`
    : seconds < 60
      ? `${Math.floor(seconds)}s`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
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

/** "Read 3 files, ran 2 commands, and edited 1 file" */
export function summarizeActivity(activity: AgentActivity[]) {
  const groups = new Map<AgentActivity["kind"], Set<string>>();
  for (const a of activity) {
    const seen = groups.get(a.kind) ?? new Set();
    // Repeated reads or edits of one file count once; commands and tools count every call.
    seen.add(a.kind === "read" || a.kind === "file" ? a.label : a.id);
    groups.set(a.kind, seen);
  }
  const parts = [...groups].map(([kind, seen], index) => {
    const text = summaries[kind](seen.size);
    return index === 0 ? text : text.charAt(0).toLowerCase() + text.slice(1);
  });
  if (parts.length < 3) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export const baseName = (path: string) =>
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
]);

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
      (commandWrappers.has(words[0]) || /^\w+=/.test(words[0]))
    )
      words.shift();
    const word = words[0]?.replace(/^["'(]+|["')]+$/g, "");
    if (!word || commandSetup.has(word)) continue;
    return word.split("/").at(-1) || word;
  }
}

/** The past-tense line for a finished call, e.g. "Ran rg" or "Read AgentTurn.tsx". */
export function doneLabel(a: AgentActivity) {
  switch (a.kind) {
    case "command":
      return `${a.status === "failed" ? "Failed" : "Ran"} ${programName(a.label) ?? "command"}`;
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
