import { agentName, type AgentProvider } from "../../shared/agents";

export type AgentErrorKind = "signedOut" | "usageLimit";

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
