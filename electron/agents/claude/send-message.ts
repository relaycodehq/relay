// Claude Code's SendMessage reaches another session, a teammate, or one of
// the session's own subagents. To a subagent its result is only a receipt:
// the agent was woken, or reads the message at its next step. What the agent
// then does and reports comes later, as the agent's own run.
import type { AgentActivity, AgentTrace } from "../../../shared/projects";

export type Send = { to: string; message: string };

/** How a message reached a subagent; `agentId` when its receipt names the agent. */
export type Delivery = { how: "resumed" | "queued"; agentId?: string };

/** Finds the session's agent a delivered message went to. */
export type MessagedAgent = (
  to: string,
  delivery: Delivery,
) => { id: string; description: string } | undefined;

/** Who a SendMessage call writes to and what it says; undefined for any other call. */
export function sendOf(name: string, input: unknown): Send | undefined {
  if (name !== "SendMessage") return undefined;
  const { to, message } = (input ?? {}) as { to?: unknown; message?: unknown };
  if (typeof to !== "string" || typeof message !== "string" || !message)
    return undefined;
  return { to, message };
}

function receiptFields(receipt: string) {
  try {
    const fields: unknown = JSON.parse(receipt);
    return fields && typeof fields === "object"
      ? (fields as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * How a message reached a subagent, read from the call's result. Undefined
 * when it went to anyone else, or didn't go.
 */
export function deliveryOf(receipt: string): Delivery | undefined {
  const { success, message, resumedAgentId, revivedAgentId } =
    receiptFields(receipt);
  if (success !== true || typeof message !== "string") return undefined;
  const named = (id: unknown): id is string => typeof id === "string" && !!id;
  // Newer Claude Code names an agent that reports to another agent as
  // `revivedAgentId` only; older ones don't name it at all.
  const agentId = [resumedAgentId, revivedAgentId].find(named);
  if (agentId) return { how: "resumed", agentId };
  if (message.startsWith("Resuming agent ")) return { how: "resumed" };
  // Said of an agent still working, and of one another caller is waking.
  const waitsForItsNextStep =
    /\bqueued for (delivery to .+ at )?its next tool round\b/;
  return waitsForItsNextStep.test(message) ? { how: "queued" } : undefined;
}

const deliveryNotes: Record<Delivery["how"], string> = {
  resumed: "Resumed",
  queued: "Queued for its next step",
};

/**
 * A delivered message's row in Claude's turn: which agent it went to, how it
 * reached it and what it said, in place of the receipt. `agent` is the
 * agent's task, or the name Claude addressed when Relay doesn't know it.
 */
export function sentRow(
  row: AgentActivity,
  send: Send,
  delivery: Delivery,
  agent: string,
): AgentActivity {
  return {
    ...row,
    label: `Message to agent: ${agent}`.slice(0, 500),
    detail: `${deliveryNotes[delivery.how]}\n\n${send.message}`.slice(0, 8000),
  };
}

/**
 * The same message in the agent's own trace, where it came in: quoted, so it
 * doesn't read as something the agent said, and not a call it made.
 */
export function heardNote(sendId: string, send: Send): AgentTrace {
  const quoted = send.message
    .slice(0, 8000)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return {
    kind: "commentary",
    id: `heard:${sendId}`,
    text: `**Message from Claude**\n\n${quoted}`,
  };
}
