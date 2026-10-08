import type { AgentProvider, ChatMessage } from "../../shared/projects";
import { agentName } from "../../shared/agents";
import { readTurn } from "../../shared/agent-trace";

const MAX_CHANGED = 40;
const MAX_READ = 30;
const MAX_COMMANDS = 15;

const unique = (items: string[]) => [...new Set(items.filter(Boolean))];
const last = <T>(items: T[], n: number) =>
  items.length > n ? items.slice(-n) : items;
const clip = (text: string, n: number) =>
  text.length > n ? `${text.slice(0, n)}…` : text;

/**
 * The handoff note Relay writes itself when the outgoing agent couldn't,
 * say because it hit a usage limit: what that agent touched and ran, taken
 * from the turns it left in the thread, and where its last turn stopped.
 * `conversation` is the branch the new agent continues, oldest first.
 */
export function relayNote(
  conversation: ChatMessage[],
  from: AgentProvider,
): string {
  const answers = conversation.filter(
    (m) =>
      m.role === "assistant" &&
      m.provider === from &&
      !m.side &&
      !m.compaction &&
      !m.handoff &&
      !m.reload &&
      !m.worktreeCommand,
  );
  const calls = answers.flatMap((m) => readTurn(m).activity);
  const done = (kind: string) =>
    calls.filter((a) => a.kind === kind && a.status !== "running");
  const changed = unique([
    ...answers.flatMap((m) =>
      (m.changes ?? []).filter((c) => !c.revertedBy).map((c) => c.path),
    ),
    ...done("file").map((a) => a.label),
  ]);
  const read = unique(done("read").map((a) => a.label)).filter(
    (p) => !changed.includes(p),
  );
  const commands = done("command").map(
    (a) => `${clip(a.label, 300)}${a.status === "failed" ? "  (failed)" : ""}`,
  );
  const name = agentName(from);
  const first = conversation.find((m) => m.role === "user" && m.body.trim());
  const end = answers.at(-1);
  const lines = [
    `${name} couldn't write a handoff note, so Relay put this together from the turns ${name} left in this thread. It lists what was done, not why; re-read files before relying on them.`,
  ];
  if (first)
    lines.push(
      "",
      "The thread's first request:",
      clip(first.body.trim(), 2000),
    );
  if (changed.length)
    lines.push(
      "",
      `Files ${name} changed:`,
      ...last(changed, MAX_CHANGED).map((p) => `- ${p}`),
    );
  if (read.length)
    lines.push(
      "",
      `Files ${name} read:`,
      ...last(read, MAX_READ).map((p) => `- ${p}`),
    );
  if (commands.length)
    lines.push(
      "",
      `Latest commands ${name} ran:`,
      ...last(commands, MAX_COMMANDS).map((c) => `- ${c}`),
    );
  if (end && end.status !== "complete") {
    const turn = readTurn(end);
    const said = [...(end.trace ?? [])]
      .reverse()
      .find((e) => e.kind === "commentary" && e.text.trim());
    const lastCall = turn.activity.at(-1);
    lines.push(
      "",
      `${name}'s last turn didn't finish (${end.status}${end.error ? `: ${clip(end.error.trim(), 300)}` : ""}).`,
    );
    if (said?.kind === "commentary")
      lines.push(`The last thing it said: ${clip(said.text.trim(), 1500)}`);
    if (lastCall)
      lines.push(
        `Its last call: ${lastCall.kind} ${clip(lastCall.label, 300)} (${lastCall.status}).`,
      );
    if (end.body.trim())
      lines.push(
        `Its unfinished answer ended with: ${end.body.trim().slice(-1500)}`,
      );
  }
  return lines.join("\n");
}
