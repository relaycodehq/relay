import { agentName } from "../../../shared/agents";
import type { CommandOption } from "../../../shared/commands";
import { errorMessage } from "../../../shared/error-message";
import {
  continuesAsCopy,
  terminalAgents,
  type TerminalSession,
} from "../../../shared/terminal-sessions";
import { timeAgo } from "../../lib/relative-date";

const when = (updated: number) =>
  Date.now() - updated < 60_000
    ? "just now"
    : timeAgo(new Date(updated).toISOString());

/** The muted line under a session's title. */
export function sessionDetail(session: TerminalSession) {
  return [
    agentName(session.provider),
    when(session.updated),
    `${session.turns} ${session.turns === 1 ? "turn" : "turns"}`,
    session.accountLabel,
    session.chatId
      ? "in Relay"
      : session.app
        ? `from the ${agentName(session.provider)} app, continues as a copy`
        : session.live
          ? "open in a terminal, continues as a copy"
          : continuesAsCopy(session)
            ? "continues as a copy"
            : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

const AGENT_WORDS = new Set(
  terminalAgents.map((a) => agentName(a).toLocaleLowerCase()),
);

/**
 * Sessions matching every word typed. An agent's name, "app" or "terminal"
 * picks where the session ran (`/resume codex app …`). "chatgpt" aliases
 * the Codex desktop app (`/resume chatgpt …`); other words search
 * the title.
 */
export function matchingSessions(sessions: TerminalSession[], search: string) {
  const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    const title = session.title.toLocaleLowerCase();
    return words.every((word) =>
      word === "chatgpt"
        ? session.provider === "codex" && !!session.app
        : AGENT_WORDS.has(word)
          ? agentName(session.provider).toLocaleLowerCase() === word
          : word === "app" || word === "terminal"
            ? (word === "app") === !!session.app
            : title.includes(word),
    );
  });
}

export const sessionKey = (session: Pick<TerminalSession, "provider" | "id">) =>
  `${session.provider}:${session.id}`;

/** Options that only say why there's nothing to pick. */
export const NONE = ":none";
export const LOOKING = ":looking";
export const FAILED = ":failed";

export const notice = (
  value: string,
  label: string,
  description?: string,
): CommandOption => ({ value, label, description, source: "" });

/** The `/resume` menu for the last lookup: its sessions, why it failed, or that it's still going. */
export function listingOptions(
  lookup: { sessions?: TerminalSession[]; error?: unknown },
  query: string,
  where: string,
  projectName: string,
): CommandOption[] {
  if (lookup.sessions)
    return sessionOptions(lookup.sessions, query, where, projectName);
  if (lookup.error)
    return [
      notice(FAILED, "Couldn't look for sessions", errorMessage(lookup.error)),
    ];
  return [notice(LOOKING, "Looking for sessions…")];
}

/** The `/resume` menu's rows for the sessions matching `query`; `where` leads each one's detail. */
export function sessionOptions(
  sessions: TerminalSession[],
  query: string,
  where: string,
  projectName: string,
): CommandOption[] {
  const found = matchingSessions(sessions, query).map((s) => ({
    value: sessionKey(s),
    label: s.title,
    description: where + sessionDetail(s),
    source: s.app ? `${agentName(s.provider)} app` : "Terminal",
    terminal: true,
  }));
  if (found.length || query) return found;
  return [
    notice(
      NONE,
      "No sessions to resume",
      `No saved sessions found in ${projectName}`,
    ),
  ];
}
