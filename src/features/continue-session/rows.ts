import { agentName } from "../../../shared/agents";
import {
  continuesAsCopy,
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
      : session.live
        ? "open in a terminal, continues as a copy"
        : continuesAsCopy(session)
          ? "continues as a copy"
          : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Sessions whose title or agent holds every word typed. */
export function matchingSessions(sessions: TerminalSession[], search: string) {
  const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter((session) => {
    const text =
      `${session.title} ${agentName(session.provider)}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export const sessionKey = (session: Pick<TerminalSession, "provider" | "id">) =>
  `${session.provider}:${session.id}`;
