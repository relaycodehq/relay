// What a process's command line says: which agent it is, whether it's only
// incidentally in a project folder, and how a shell would run it again.
import { agentProviders, type AgentProvider } from "../../shared/agents";
import { shellCommand, windowsArgs } from "../../shared/tasks";

const windows = process.platform === "win32";

/** Which agent's CLI a command line runs, if any. */
export const agentName = (line: string) => {
  const [bin, arg] = windows ? windowsArgs(line) : line.split(/\s+/);
  const file = /[^/\\]+$/.exec(bin ?? "")?.[0] ?? "";
  // Windows names files in any case; elsewhere "Claude" is the desktop app.
  const name = windows ? file.replace(/\.exe$/i, "").toLowerCase() : file;
  // Each agent's CLI is named after it; Codex may also run as a Node script.
  if (agentProviders.some((p) => p === name)) return name as AgentProvider;
  if (name === "node" && /[/\\]codex(\.js)?$/.test(arg ?? ""))
    return "codex" as const;
};

// Processes that are only incidentally in a project folder: installed apps, system daemons,
// Git's own helpers and other editors' agents.
export const ignoredOrphans =
  /^(\/System\/|\/Applications\/|\/Users\/[^/]+\/Applications\/|\/usr\/libexec\/|\/usr\/sbin\/|\/sbin\/|\/Library\/)|\bgit fsmonitor--daemon\b|\bwatchman\b|\bgitstatusd\b|\bcursor-agent\b|--relay-agent-host\b|\bchrome_crashpad_handler\b/;

/** A process's command line as something a shell can run: `ps` loses the quoting of an executable path with spaces. */
export const runnable = (line: string) =>
  shellCommand(line) ??
  line.replace(/^(\/.*?)(?= -| \/|$)/, (path) =>
    path.includes(" ") ? `'${path.replaceAll("'", `'\\''`)}'` : path,
  );
