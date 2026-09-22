export const relayCommands = [
  { name: "openpr", description: "Open this branch’s PR, or create one" },
  { name: "changes", description: "Review local uncommitted changes" },
  { name: "files", description: "Browse project files" },
  { name: "new", description: "Start a new thread in this project" },
] as const;
export type RelayCommand = (typeof relayCommands)[number]["name"];
export interface ProviderCommand {
  displayName?: string;
  source?: "app" | "repo" | "project" | "personal" | "system" | "other";
  name: string;
  description: string;
}
export function relayCommand(text: string): RelayCommand | null {
  const match = /^\/([a-z]+)\s*$/i.exec(text.trim());
  return (
    relayCommands.find((c) => c.name === match?.[1]?.toLowerCase())?.name ??
    null
  );
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
