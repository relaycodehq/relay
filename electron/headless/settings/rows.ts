// What `relay settings` lists: each setting's key, its section and how its
// value reads.
import type { AgentVersion } from "../../../shared/agent-updates";
import { agentInfo, type AgentProvider } from "../../../shared/agents";
import type { WatchScope } from "../../../shared/watch";
import { bold, dim, green, yellow } from "../format";
import type { Snapshot } from "./snapshot";
import { dictationValue, voiceValue } from "./speech";

export const cliName = (provider: string) =>
  agentInfo(provider as AgentProvider)?.cli ?? provider;

const days = (n: number | null, zero = "right away") =>
  n === null ? "never" : n === 0 ? zero : `after ${n} day${n === 1 ? "" : "s"}`;
export const watchLabels: Record<WatchScope, string> = {
  off: "off",
  main: "the main thread",
  subagents: "the main thread and its subagents",
};

function agentValue(agent: AgentVersion | undefined) {
  if (!agent?.path) return dim("not found");
  const account = agent.account
    ? agent.account.signedIn
      ? green(
          agent.account.email
            ? `signed in as ${agent.account.email}`
            : "signed in",
        )
      : yellow("signed out")
    : "";
  return [
    agent.current,
    account,
    dim(agent.path + (agent.linked ? " (set here)" : "")),
  ]
    .filter(Boolean)
    .join("  ");
}

function cursorValue(agent: AgentVersion | undefined) {
  if (!agent?.current) return dim("not set up");
  return agent.account?.signedIn
    ? green(
        agent.account.email
          ? `signed in as ${agent.account.email}`
          : "signed in",
      )
    : yellow("signed out");
}

export interface Row {
  key: string;
  section: "General" | "Agents" | "Phones";
  label: string;
  value(s: Snapshot): string;
}

export const rows: Row[] = [
  { key: "name", section: "General", label: "Name", value: (s) => s.name },
  {
    key: "port",
    section: "General",
    label: "Port",
    value: (s) => String(s.port),
  },
  {
    key: "auto-update",
    section: "General",
    label: "Install updates automatically",
    value: (s) =>
      s.update.status === "off"
        ? dim("not for a build from source; git pull updates it")
        : `${s.autoUpdate ? "on" : "off"}${s.update.status === "available" ? yellow(`  (${s.update.version} is out)`) : ""}`,
  },
  {
    key: "keep-awake",
    section: "General",
    label: "Keep the computer awake",
    value: (s) => (s.keepAwake ? "on" : "off"),
  },
  {
    key: "usage-ping",
    section: "General",
    label: "Count me as a user",
    value: (s) => (s.usagePing ? "on" : "off"),
  },
  {
    key: "auto-settle",
    section: "General",
    label: "Settle quiet threads",
    value: (s) => days(s.autoSettleDays),
  },
  {
    key: "worktree-cleanup",
    section: "General",
    label: "Remove settled threads' worktrees",
    value: (s) => days(s.worktreeCleanupDays),
  },
  {
    key: "new-thread-agent",
    section: "Agents",
    label: "New threads start with",
    value: (s) =>
      s.newThreadAgent
        ? agentInfo(s.newThreadAgent).name
        : dim("the last one used"),
  },
  ...(["claude", "codex", "opencode", "muse", "amp"] as const).map(
    (provider): Row => ({
      key: provider,
      section: "Agents",
      label: agentInfo(provider).cli,
      value: (s) => agentValue(s.agents.find((a) => a.provider === provider)),
    }),
  ),
  {
    key: "cursor",
    section: "Agents",
    label: "Cursor",
    value: (s) => cursorValue(s.agents.find((a) => a.provider === "cursor")),
  },
  {
    key: "watch-threads",
    section: "Agents",
    label: "Flag what I'd miss (Claude)",
    value: (s) => watchLabels[s.watchThreads],
  },
  {
    key: "git",
    section: "Agents",
    label: "Git",
    value: (s) =>
      s.git.path
        ? `${s.git.version ?? ""}  ${dim(s.git.path + (s.git.chosen ? " (set here)" : ""))}`
        : yellow(s.git.error ?? "not found"),
  },
  {
    key: "gitea",
    section: "Agents",
    label: "Gitea",
    value: (s) =>
      s.gitea
        ? `${s.gitea.user.login} on ${s.gitea.server}`
        : dim("not signed in"),
  },
  {
    key: "phone-access",
    section: "Phones",
    label: "Phone access",
    value: (s) => (s.phoneAccess ? "on" : "off"),
  },
  {
    key: "dictation",
    section: "Phones",
    label: "Dictation",
    value: (s) => dictationValue(s.speech),
  },
  {
    key: "read-aloud",
    section: "Phones",
    label: "Read aloud",
    value: (s) => voiceValue(s.speech),
  },
];

export function print(s: Snapshot, numbered: boolean) {
  const width = Math.max(...rows.map((r) => r.label.length));
  let section = "";
  rows.forEach((row, i) => {
    if (row.section !== section) {
      section = row.section;
      console.log(`\n${bold(section)}`);
    }
    const n = numbered ? `${String(i + 1).padStart(3)}  ` : "  ";
    console.log(`${n}${row.label.padEnd(width)}  ${row.value(s)}`);
  });
}
