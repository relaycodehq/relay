import {
  agentName,
  agents,
  type AgentInfo,
  type AgentProvider,
} from "../../../shared/agents";

export type SignInOffer =
  | {
      via: "terminal";
      label: string;
      /** What to run by hand when the terminal can't take it typed. */
      command: string;
    }
  | { via: "relay"; label: string };

/** How a signed-out agent signs in: its own CLI login in the thread's terminal, or Relay's browser sign-in. */
export function signInOffer(provider: AgentProvider): SignInOffer {
  const name = agentName(provider);
  const login = (agents[provider] as AgentInfo).login;
  return login
    ? {
        via: "terminal",
        label: `Sign in to ${name} in the terminal`,
        command: `${provider} ${login}`,
      }
    : { via: "relay", label: `Sign in to ${name}` };
}
