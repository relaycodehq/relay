import { agentName } from "../../../shared/agents";
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
