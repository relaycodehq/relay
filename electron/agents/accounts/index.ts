// The agents' accounts: which exist, the one new threads start on, and the
// order auto-switch moves down when one runs out. Runtimes ask `runAccount`
// which account a run uses and the environment that signs it in.
import { randomUUID } from "node:crypto";
import {
  accountProviders,
  SYSTEM_ACCOUNT,
  threadAccount,
  type AccountProvider,
  type AgentAccountsState,
  type StoredAccount,
} from "../../../shared/agent-accounts";
import type { ProviderUsage } from "../../../shared/provider-usage";
import type { Store } from "../../app/store";
import { readIdentity } from "./identity";
import { accountEnv, prepareProfile, removeProfile } from "./profiles";
import { startSignIn, type SignIn } from "./sign-in";

export { setProfilesRoot } from "./profiles";

/** A window this full has stopped the account. */
const SPENT = 99.5;
/** How long an account a limit stopped is skipped when the limit didn't say. */
const SPENT_FALLBACK = 5 * 60 * 60_000;

type Usage = (provider: AccountProvider, id: string) => Promise<ProviderUsage>;
/** The saved accounts made whole. */
type Accounts = {
  accounts: StoredAccount[];
  inUse: Record<AccountProvider, string>;
  autoSwitch: boolean;
};

let current: AgentAccounts | undefined;

/**
 * The account a run uses, `pinned` while it exists, and the environment
 * that signs its CLI in. Without accounts set up, the CLI's usual sign-in.
 */
export async function runAccount(
  provider: AccountProvider,
  pinned?: string,
): Promise<{ id: string; env: Record<string, string> }> {
  const id = current?.resolve(provider, pinned) ?? SYSTEM_ACCOUNT;
  return { id, env: await signedInAs(provider, id) };
}

/** The environment that signs the CLI in as exactly this account. */
export async function signedInAs(provider: AccountProvider, id: string) {
  if (id !== SYSTEM_ACCOUNT) await prepareProfile(provider, id);
  return accountEnv(provider, id);
}

/** The account a thread runs `provider` on: `pinned` while it exists, else the one in use. */
export const accountFor = (provider: AccountProvider, pinned?: string) =>
  current?.resolve(provider, pinned) ?? SYSTEM_ACCOUNT;

export const accountLabel = (provider: AccountProvider, id: string) =>
  current?.label(provider, id) ?? "Default";

/** See `AgentAccounts.moveOn`. */
export const moveAccountOn = (
  provider: AccountProvider,
  from: string,
  resetsAt: number | undefined,
) => current?.moveOn(provider, from, resetsAt) ?? Promise.resolve(undefined);

export class AgentAccounts {
  private signIn:
    | (SignIn & { provider: AccountProvider; id: string; label: string })
    | null = null;
  private signInError: string | null = null;
  /** Accounts a usage limit stopped, until it lifts. */
  private spent = new Map<string, number>();

  constructor(
    private store: Store,
    private send: (state: AgentAccountsState) => void,
    private usage: Usage,
  ) {
    current = this;
  }

  /** Saved accounts made whole: each agent's usual sign-in is always there. */
  private stored(): Accounts {
    const saved = this.store.get().agentAccounts;
    const accounts = [...(saved?.accounts ?? [])];
    for (const provider of accountProviders)
      if (!accounts.some((a) => a.provider === provider && a.id === SYSTEM_ACCOUNT))
        accounts.unshift({ provider, id: SYSTEM_ACCOUNT, label: "Default" });
    const inUse: Record<AccountProvider, string> = {
      claude: SYSTEM_ACCOUNT,
      codex: SYSTEM_ACCOUNT,
    };
    for (const provider of accountProviders) {
      const id = saved?.inUse?.[provider];
      if (id && accounts.some((a) => a.provider === provider && a.id === id))
        inUse[provider] = id;
    }
    return { accounts, inUse, autoSwitch: saved?.autoSwitch ?? true };
  }

  private async save(change: (saved: Accounts) => void) {
    const saved = this.stored();
    change(saved);
    await this.store.update((s) => {
      s.agentAccounts = saved;
    });
    await this.changed();
  }

  private async changed() {
    this.send(await this.state());
  }

  async state(): Promise<AgentAccountsState> {
    const { accounts, inUse, autoSwitch } = this.stored();
    return {
      accounts: await Promise.all(
        accounts.map(async (account) => ({
          ...account,
          system: account.id === SYSTEM_ACCOUNT,
          ...(await readIdentity(account.provider, account.id).catch(() => ({
            signedIn: false,
          }))),
        })),
      ),
      inUse,
      autoSwitch,
      signingIn: this.signIn && {
        provider: this.signIn.provider,
        id: this.signIn.id,
        label: this.signIn.label,
      },
      signInError: this.signInError,
    };
  }

  resolve(provider: AccountProvider, pinned?: string) {
    return threadAccount(this.stored(), provider, pinned);
  }

  /** Signs a new account in; it joins the list once the CLI has saved its sign-in. */
  add(provider: AccountProvider, label: string) {
    return this.runSignIn(provider, randomUUID().slice(0, 8), label, true);
  }

  /** Runs the sign-in again, for an account whose login expired or was revoked. */
  signInAgain(provider: AccountProvider, id: string) {
    const account = this.find(provider, id);
    return this.runSignIn(provider, id, account.label, false);
  }

  cancelSignIn() {
    this.signIn?.cancel();
  }

  private async runSignIn(
    provider: AccountProvider,
    id: string,
    label: string,
    fresh: boolean,
  ) {
    if (this.signIn)
      throw new Error("Finish or cancel the sign-in that's already open.");
    if (id !== SYSTEM_ACCOUNT) await prepareProfile(provider, id);
    const flow = await startSignIn(provider, accountEnv(provider, id));
    this.signIn = { ...flow, provider, id, label };
    this.signInError = null;
    void flow.done
      .then(async () => {
        const { signedIn } = await readIdentity(provider, id);
        if (!signedIn) throw new Error("The sign-in didn't save an account.");
        if (fresh)
          await this.store.update((s) => {
            const saved = this.stored();
            saved.accounts.push({ provider, id, label });
            s.agentAccounts = saved;
          });
      })
      .catch(async (e: Error) => {
        this.signInError = e.message === "Sign-in cancelled." ? null : e.message;
        if (fresh) await removeProfile(provider, id).catch(() => {});
      })
      .finally(() => {
        this.signIn = null;
        void this.changed();
      });
    await this.changed();
  }

  private find(provider: AccountProvider, id: string) {
    const account = this.stored().accounts.find(
      (a) => a.provider === provider && a.id === id,
    );
    if (!account) throw new Error("That account is gone.");
    return account;
  }

  rename(provider: AccountProvider, id: string, label: string) {
    this.find(provider, id);
    return this.save((saved) => {
      for (const a of saved.accounts)
        if (a.provider === provider && a.id === id) a.label = label;
    });
  }

  async remove(provider: AccountProvider, id: string) {
    if (id === SYSTEM_ACCOUNT)
      throw new Error("The CLI's own sign-in stays; sign out in the CLI instead.");
    this.find(provider, id);
    await this.save((saved) => {
      saved.accounts = saved.accounts.filter(
        (a) => !(a.provider === provider && a.id === id),
      );
      if (saved.inUse[provider] === id)
        saved.inUse[provider] = saved.accounts.find(
          (a) => a.provider === provider,
        )!.id;
    });
    await removeProfile(provider, id);
  }

  /** Moves an account one place up or down its agent's list. */
  move(provider: AccountProvider, id: string, by: -1 | 1) {
    this.find(provider, id);
    return this.save((saved) => {
      const mine = saved.accounts.filter((a) => a.provider === provider);
      const at = mine.findIndex((a) => a.id === id);
      const to = at + by;
      if (to < 0 || to >= mine.length) return;
      [mine[at], mine[to]] = [mine[to]!, mine[at]!];
      saved.accounts = [
        ...saved.accounts.filter((a) => a.provider !== provider),
        ...mine,
      ];
    });
  }

  use(provider: AccountProvider, id: string) {
    this.find(provider, id);
    return this.save((saved) => {
      saved.inUse[provider] = id;
    });
  }

  setAutoSwitch(on: boolean) {
    return this.save((saved) => {
      saved.autoSwitch = on;
    });
  }

  /**
   * A usage limit stopped `from`: the next account down the list, wrapping
   * to the top, that is signed in and has room, now in use. Undefined when
   * auto-switch is off or none has room, and the answer waits for the reset.
   */
  async moveOn(
    provider: AccountProvider,
    from: string,
    resetsAt: number | undefined,
  ): Promise<string | undefined> {
    this.spent.set(`${provider}:${from}`, resetsAt ?? Date.now() + SPENT_FALLBACK);
    const { accounts, autoSwitch } = this.stored();
    if (!autoSwitch) return;
    const mine = accounts.filter((a) => a.provider === provider);
    const at = mine.findIndex((a) => a.id === from);
    for (const next of [...mine.slice(at + 1), ...mine.slice(0, Math.max(at, 0))]) {
      if (next.id === from) continue;
      if ((this.spent.get(`${provider}:${next.id}`) ?? 0) > Date.now()) continue;
      if (!(await readIdentity(provider, next.id).catch(() => null))?.signedIn)
        continue;
      const usage = await this.usage(provider, next.id).catch(() => null);
      if (!usage || usage.windows.some((w) => w.usedPercent >= SPENT)) continue;
      await this.use(provider, next.id);
      return next.id;
    }
  }

  label(provider: AccountProvider, id: string) {
    return (
      this.stored().accounts.find((a) => a.provider === provider && a.id === id)
        ?.label ?? "Default"
    );
  }
}
