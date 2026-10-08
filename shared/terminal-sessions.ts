import { z } from "zod";

/** The agents whose terminal sessions a thread can continue. */
export const terminalAgents = ["claude", "codex"] as const;
export type TerminalAgent = (typeof terminalAgents)[number];

/**
 * A session whose file changed this recently still has a terminal on it.
 * Claude Code also lists the sessions its running processes hold, so a quiet
 * one counts too; Codex says nothing of the sort.
 */
export const LIVE_WINDOW = 60_000;

/** A Claude Code or Codex session started in a terminal in the project's folder. */
export interface TerminalSession {
  provider: TerminalAgent;
  id: string;
  /** Its name, else its first prompt. */
  title: string;
  /** When its file last changed. */
  updated: number;
  /** Prompts the user sent in it. */
  turns: number;
  /** The account whose folder holds it. */
  account: string;
  /** That account's name, when the agent has more than one. */
  accountLabel?: string;
  /** A terminal had it open when listed, as far as can be told. */
  live: boolean;
  /** The thread that already continues it. */
  chatId?: string;
}

/**
 * Whether a thread carries on in a copy of the session rather than the
 * session itself: always for Codex, which can't say whether a terminal still
 * holds it, and for a Claude session a terminal holds.
 */
export const continuesAsCopy = (
  session: Pick<TerminalSession, "provider" | "live">,
) => session.provider === "codex" || session.live;

export const terminalSessionPickSchema = z
  .object({
    provider: z.enum(terminalAgents),
    session: z.string().regex(/^[A-Za-z0-9-]{8,80}$/),
  })
  .strict();
export type TerminalSessionPick = z.infer<typeof terminalSessionPickSchema>;

/** Where a thread continued from: a terminal session, resumed or forked. */
export interface FromTerminal {
  provider: TerminalAgent;
  session: string;
  /**
   * `forked`: the agent carries on in a copy cut after the last finished
   * answer (see `continuesAsCopy`). `text`: a copy with no such answer, so
   * the agent gets the conversation as text.
   */
  how: "resumed" | "forked" | "text";
  /** A terminal had it open when it was brought over. */
  open: boolean;
  /** The last message brought over from the terminal. */
  through: string;
}
