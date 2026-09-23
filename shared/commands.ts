export const relayCommands = [
  { name: "openpr", description: "Open this branch’s PR, or create one" },
  { name: "changes", description: "Review local uncommitted changes" },
  { name: "files", description: "Browse project files" },
  { name: "new", description: "Start a new thread in this project" },
  { name: "clear", description: "Start a new thread with empty context" },
  {
    name: "compact",
    description: "Summarize earlier turns to free context",
    args: "[instructions]",
  },
  { name: "context", description: "Show context window usage" },
  { name: "model", description: "Choose the model", args: "[model]" },
  {
    name: "effort",
    description: "Set reasoning effort",
    args: "<level>",
  },
  { name: "plan", description: "Toggle plan mode", args: "[on|off]" },
  {
    name: "permissions",
    description: "Set what the agent may do without asking",
    args: "<mode>",
  },
  { name: "fast", description: "Toggle Codex Fast mode", args: "[on|off]" },
] as const;
export type RelayCommand = (typeof relayCommands)[number]["name"];
/** Commands the composer applies to its own settings. */
export const composerCommands: readonly RelayCommand[] = [
  "model",
  "effort",
  "plan",
  "permissions",
  "fast",
];
export interface ProviderCommand {
  displayName?: string;
  source?:
    | "app"
    | "repo"
    | "project"
    | "personal"
    | "system"
    | "claude"
    | "other";
  name: string;
  description: string;
  argumentHint?: string;
}
export interface CommandOption {
  value: string;
  label: string;
  description?: string;
}
/** Relay commands take arguments only where they declare them. */
export function relayCommand(
  text: string,
): { name: RelayCommand; args: string } | null {
  const match = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  const command = relayCommands.find(
    (c) => c.name === match?.[1]?.toLowerCase(),
  );
  const args = match?.[2]?.trim() ?? "";
  if (!command || (args && !("args" in command))) return null;
  return { name: command.name, args };
}
/** The argument being typed after a command name, e.g. `/effort hi`. */
export function argumentTrigger(text: string, cursor = text.length) {
  const match = /^\/([a-z]+) (\S*)$/i.exec(text.slice(0, cursor));
  return match ? { name: match[1].toLowerCase(), query: match[2] } : null;
}
/** Slash actions start a message; $skill references can appear anywhere. */
export function commandTrigger(text: string, cursor = text.length) {
  const before = text.slice(0, cursor);
  const match = /(^|\s)([$/])([^\s]*)$/.exec(before);
  if (!match || (match[2] === "/" && before.slice(0, match.index).trim()))
    return null;
  return {
    prefix: match[2] as "/" | "$",
    query: match[3],
    start: match.index + match[1].length,
    end: cursor,
  };
}
