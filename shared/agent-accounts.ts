// Several sign-ins for the agents whose CLIs can keep them apart: each extra
// account is a config folder of its own (CLAUDE_CONFIG_DIR, CODEX_HOME), and
// the CLI's usual one stays where it put it.
import { z } from "zod";

export const accountProviders = ["claude", "codex"] as const;
export type AccountProvider = (typeof accountProviders)[number];
export const accountProviderSchema = z.enum(accountProviders);
export const hasAccounts = (provider: string): provider is AccountProvider =>
  (accountProviders as readonly string[]).includes(provider);

/** The CLI's own sign-in, in ~/.claude or ~/.codex; it can't be removed. */
export const SYSTEM_ACCOUNT = "default";
export const accountIdSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/, "Not an account.");
export const accountLabelSchema = z
  .string()
  .trim()
  .min(1, "Name the account.")
  .max(40)
  .refine((value) => !/[\x00-\x1f]/.test(value), "Use a plain name.");

/** What Relay keeps of an account; who it signs in as is read from its folder. */
export interface StoredAccount {
  provider: AccountProvider;
  id: string;
  label: string;
}
export interface StoredAccounts {
  /** In each agent's order: when one runs out, the next one down takes over. */
  accounts: StoredAccount[];
  /** The account new threads start on. */
  inUse?: Partial<Record<AccountProvider, string>>;
  /** Move an answer on to the next account when a limit stops it; unset is on. */
  autoSwitch?: boolean;
}

export interface AgentAccount extends StoredAccount {
  system: boolean;
  signedIn: boolean;
  email?: string;
  /** The subscription, e.g. Max or Plus. */
  plan?: string;
}
export interface AgentAccountsState {
  accounts: AgentAccount[];
  inUse: Record<AccountProvider, string>;
  autoSwitch: boolean;
  /** A sign-in Relay started and is waiting on, in the browser. */
  signingIn: { provider: AccountProvider; id: string; label: string } | null;
  /** Why the last sign-in didn't finish. */
  signInError: string | null;
}

export const accountsOf = (
  state: Pick<AgentAccountsState, "accounts">,
  provider: AccountProvider,
) => state.accounts.filter((a) => a.provider === provider);

/**
 * The account a thread runs `provider` on: the one it was pinned to, while
 * that still exists here, else the one in use.
 */
export function threadAccount(
  state: {
    accounts: readonly StoredAccount[];
    inUse: Record<AccountProvider, string>;
  },
  provider: AccountProvider,
  pinned: string | undefined,
): string {
  return pinned &&
    state.accounts.some((a) => a.provider === provider && a.id === pinned)
    ? pinned
    : state.inUse[provider];
}

/** The account a thread pinned for `provider`, if the agent has accounts. */
export const pinnedAccount = (
  accounts: Partial<Record<AccountProvider, string>> | undefined,
  provider: string,
) => (hasAccounts(provider) ? accounts?.[provider] : undefined);

/** An answer a usage limit stopped, carried on with another account. */
export interface AccountMove {
  provider: AccountProvider;
  /** Labels as they were then, so a rename later doesn't rewrite history. */
  from: string;
  to: string;
}
