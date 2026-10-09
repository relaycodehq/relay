// Sample agents and accounts for the AI models rework.
import type { AgentProvider } from "../../shared/agents";
import {
  SESSION_MS,
  WEEK_MS,
  type ProviderUsage,
} from "../../shared/provider-usage";

const NOW = Date.now();
const hour = 60 * 60 * 1000;

export const usage = (
  session: number,
  weekly: number,
  sessionResetsIn = 2 * hour,
  weeklyResetsIn = 3 * 24 * hour,
): ProviderUsage => ({
  provider: "claude",
  message: null,
  windows: [
    {
      kind: "session",
      usedPercent: session,
      resetsAt: NOW + sessionResetsIn,
      periodMs: SESSION_MS,
    },
    {
      kind: "weekly",
      usedPercent: weekly,
      resetsAt: NOW + weeklyResetsIn,
      periodMs: WEEK_MS,
    },
  ],
});

export type SampleAccount = {
  id: string;
  label: string;
  who: string;
  usage?: ProviderUsage;
};

export type SampleAgent = {
  provider: AgentProvider;
  version?: string;
  installer?: string;
  latest?: string;
  /** Claude and Codex sign in per account; the others have one line. */
  accounts?: SampleAccount[];
  signIn?: { signedIn: boolean; who?: string };
  note?: string;
};

export const sampleAgents: SampleAgent[] = [
  {
    provider: "claude",
    version: "2.3.4",
    installer: "npm",
    latest: "2.3.6",
    accounts: [
      {
        id: "c-personal",
        label: "Personal",
        who: "Max 20x · lubo@example.com · ~/.claude",
        usage: usage(38, 61),
      },
      {
        id: "c-work",
        label: "Work",
        who: "Team · lubo@work.example.com",
        usage: usage(4, 22, 4 * hour, 5 * 24 * hour),
      },
    ],
  },
  {
    provider: "codex",
    version: "0.161.0",
    installer: "Homebrew",
    latest: "0.161.0",
    accounts: [
      {
        id: "x-personal",
        label: "Personal",
        who: "Pro · lubo@example.com · ~/.codex",
        usage: usage(12, 47, 3 * hour, 2 * 24 * hour),
      },
    ],
  },
  {
    provider: "opencode",
    version: "1.4.2",
    installer: "Homebrew",
    latest: "1.4.2",
    note: "Uses the providers in your OpenCode config · OpenRouter $12.40 left",
  },
  {
    provider: "cursor",
    signIn: { signedIn: false },
    note: "Relay downloads Cursor's SDK the first time you set it up.",
  },
];
