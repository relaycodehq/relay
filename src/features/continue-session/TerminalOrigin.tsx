import type { FromTerminal } from "../../../shared/terminal-sessions";
import { agentName } from "../../../shared/agents";

function note({ how, open, app, provider }: FromTerminal) {
  if (how === "resumed") return "Continued from a terminal session";
  const from = app
    ? `a ${agentName(provider)} app session`
    : open
      ? "a session still open in a terminal"
      : "a terminal session";
  return how === "forked"
    ? `Forked from ${from} · ${app ? "the app keeps the original" : open ? "the terminal keeps the original" : "the original stays as it was"}`
    : `Copied from ${from} · the agent reads it as text`;
}

/** The note under a terminal session's conversation, where the thread takes over. */
export const terminalOriginNote = (from: FromTerminal) => ({
  text: note(from),
  title: `Brought over from ${agentName(from.provider)} session ${from.session}. Not shown from ${from.app ? "the app" : "the terminal"}: thinking, images, subagents' own transcripts, local command output, and each turn's changes.`,
});
