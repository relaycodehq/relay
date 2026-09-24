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
  {
    name: "btw",
    description: "Ask a side question without interrupting the agent",
    args: "<question>",
  },
  {
    name: "provider",
    description: "Switch between Codex, Claude, and messages only",
    args: "<agent>",
  },
  { name: "model", description: "Choose the model", args: "<model>" },
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
/**
 * Commands the composer applies to its own settings. They also work in the
 * middle of a message, and take only their own text out of it.
 */
export const composerCommands: readonly RelayCommand[] = [
  "provider",
  "model",
  "effort",
  "plan",
  "permissions",
  "fast",
];
export interface ProviderCommand {
  displayName?: string;
  source?:
    "app" | "repo" | "project" | "personal" | "system" | "claude" | "other";
  name: string;
  description: string;
  argumentHint?: string;
}
export interface CommandOption {
  value: string;
  label: string;
  description?: string;
  /** Whose it is, when not Relay's, e.g. a model's agent. */
  source?: string;
  /** The setting's present value. */
  current?: boolean;
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
/**
 * The argument being typed after a command name, e.g. `/effort hi`. `inline`
 * marks one typed after other text, where only composer commands apply.
 */
export function argumentTrigger(text: string, cursor = text.length) {
  const before = text.slice(0, cursor);
  const match = /(^|\s)\/([a-z]+) (\S*)$/i.exec(before);
  if (!match) return null;
  const start = match.index + match[1].length;
  return {
    name: match[2].toLowerCase(),
    query: match[3],
    start,
    inline: !!before.slice(0, start).trim(),
  };
}
/**
 * Slash actions start a message, and composer commands can follow other text
 * (`inline`); $skill references can appear anywhere.
 */
export function commandTrigger(text: string, cursor = text.length) {
  const before = text.slice(0, cursor);
  const match = /(^|\s)([$/])([^\s]*)$/.exec(before);
  if (!match) return null;
  const start = match.index + match[1].length;
  return {
    prefix: match[2] as "/" | "$",
    query: match[3],
    start,
    end: cursor,
    inline: match[2] === "/" && !!before.slice(0, start).trim(),
  };
}
