import type { Readable } from "node:stream";
import { withDetails } from "../../shared/agent-error";
import { agentName, type AgentProvider } from "../../shared/agents";

/**
 * Keeps the end of what a child writes to stderr. The reader resolves once
 * the stream ends, or soon after the exit when something else holds it open.
 */
export function stderrTail(stream: Readable, max = 4000) {
  let tail = "";
  stream.on("data", (chunk: Buffer | string) => {
    tail = (tail + chunk.toString()).slice(-max);
  });
  const ended = new Promise<void>((resolve) => stream.once("end", resolve));
  return async () => {
    await Promise.race([ended, new Promise((r) => setTimeout(r, 300))]);
    return tail.trim();
  };
}

/**
 * An agent's process that ended mid-turn, with how it ended and its last
 * words kept in the log and in the error's technical details. `advice` only
 * shows when it said nothing: its words beat a guess at the cause.
 */
export function exitedError(
  name: string,
  how: { code: number | null; signal: NodeJS.Signals | null } | undefined,
  stderr: string,
  advice: string,
) {
  const ended = how?.signal
    ? ` (stopped by ${how.signal})`
    : how?.code != null
      ? ` (exit code ${how.code})`
      : "";
  console.warn(
    `${name} stopped before finishing${ended}:`,
    stderr || "nothing on stderr",
  );
  return new Error(
    withDetails(
      `${name} stopped before finishing${ended}.${stderr ? "" : ` ${advice}`}`,
      stderr.slice(-2000),
    ),
  );
}

export type AgentErrorKind = "signedOut" | "usageLimit" | "missingHistory";

/**
 * A turn failed in a way the thread can do something about, whichever agent
 * ran it: sign in again, or wait for a limit to lift.
 */
export class AgentError extends Error {
  constructor(
    readonly provider: AgentProvider,
    readonly kind: AgentErrorKind,
    message: string,
    /** For a usage limit: when it lifts (ms), if the agent said. */
    readonly resetsAt?: number,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export const isAgentError = (
  error: unknown,
  kind?: AgentErrorKind,
): error is AgentError =>
  error instanceof AgentError && (!kind || error.kind === kind);

/** The agent's login is missing, expired or was revoked. */
export const signedOutError = (provider: AgentProvider, message?: string) =>
  new AgentError(
    provider,
    "signedOut",
    message ??
      `${agentName(provider)} is signed out. Sign in again, then resume the answer.`,
  );

/** The agent's plan, credit or rate limit stopped the turn. */
export const usageLimitError = (
  provider: AgentProvider,
  message: string,
  resetsAt?: number,
) => new AgentError(provider, "usageLimit", message, resetsAt);
