import type { FromTerminal } from "../../../shared/terminal-sessions";
import { agentName } from "../../../shared/agents";

function note({ how, open }: FromTerminal) {
  if (how === "resumed") return "Continued from a terminal session";
  const from = open ? "a session still open in a terminal" : "a terminal session";
  return how === "forked"
    ? `Forked from ${from} · ${open ? "the terminal keeps the original" : "the original stays as it was"}`
    : `Copied from ${from} · the agent reads it as text`;
}

/** The line under a terminal session's conversation, where the thread takes over. */
export function TerminalOrigin({ from }: { from: FromTerminal }) {
  return (
    <div className="context-compaction" role="note">
      <span
        title={`Brought over from ${agentName(from.provider)} session ${from.session}. Not shown from the terminal: thinking, images, subagents' own transcripts, local command output, and each turn's changes.`}
      >
        {note(from)}
      </span>
    </div>
  );
}
