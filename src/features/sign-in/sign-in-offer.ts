import {
  agentName,
  loginArgs,
  type AgentProvider,
} from "../../../shared/agents";

export type SignInOffer =
  | {
      via: "terminal";
      label: string;
      /** What to run by hand when the terminal can't take it typed. */
      command: string;
    }
  /** Relay's own sign-in in the browser, for an agent without a login command. */
  | { via: "relay"; label: string }
  /** OpenCode's provider connections, in Relay's dialog. */
  | { via: "opencode"; label: string };

/**
 * How a signed-out agent signs in: its own CLI login typed into the thread's
 * terminal, or Relay's sign-in. `away`: the thread runs on a paired computer,
 * where only the terminal reaches; Relay's sign-ins would sign in this one.
 */
export function signInOffer(
  provider: AgentProvider,
  { away = false }: { away?: boolean } = {},
): SignInOffer | undefined {
  const name = agentName(provider);
  if (provider === "opencode")
    return away ? undefined : { via: "opencode", label: `Sign in to ${name}` };
  const login = loginArgs(provider, away);
  if (login)
    return {
      via: "terminal",
      label: `Sign in to ${name} in the terminal`,
      command: `${provider} ${login}`,
    };
  return away ? undefined : { via: "relay", label: `Sign in to ${name}` };
}
