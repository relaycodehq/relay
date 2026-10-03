// Sample accounts and the little store the three options share.
import { useState } from "react";
import {
  presentWindow,
  SESSION_MS,
  WEEK_MS,
  type UsageMeter,
} from "../../shared/provider-usage";

export type Provider = "claude" | "codex";
export type Account = {
  id: string;
  provider: Provider;
  label: string;
  /** The CLI's own sign-in (~/.claude, ~/.codex): can't be removed. */
  system?: boolean;
  email: string;
  plan: string;
  sessionUsed: number;
  weeklyUsed: number;
  sessionResetsIn: number;
  weeklyResetsIn: number;
  signedOut?: boolean;
};

const hour = 3_600_000;
const START = Date.now();

const SAMPLE: Account[] = [
  {
    id: "c-personal",
    provider: "claude",
    label: "Personal",
    system: true,
    email: "you@personal.dev",
    plan: "Max",
    sessionUsed: 86,
    weeklyUsed: 64,
    sessionResetsIn: 1.4 * hour,
    weeklyResetsIn: 52 * hour,
  },
  {
    id: "c-work",
    provider: "claude",
    label: "Work",
    email: "you@company.dev",
    plan: "Team",
    sessionUsed: 9,
    weeklyUsed: 27,
    sessionResetsIn: 4.1 * hour,
    weeklyResetsIn: 101 * hour,
  },
  {
    id: "x-personal",
    provider: "codex",
    label: "Personal",
    system: true,
    email: "you@personal.dev",
    plan: "Plus",
    sessionUsed: 3,
    weeklyUsed: 41,
    sessionResetsIn: 4.8 * hour,
    weeklyResetsIn: 30 * hour,
  },
];

export function meters(account: Account): UsageMeter[] {
  return [
    presentWindow(
      {
        kind: "session",
        usedPercent: account.sessionUsed,
        resetsAt: START + account.sessionResetsIn,
        periodMs: SESSION_MS,
      },
      START,
    ),
    presentWindow(
      {
        kind: "weekly",
        usedPercent: account.weeklyUsed,
        resetsAt: START + account.weeklyResetsIn,
        periodMs: WEEK_MS,
      },
      START,
    ),
  ];
}

/** What's left before either window stops the account. */
export const headroom = (a: Account) =>
  a.signedOut ? 0 : 100 - Math.max(a.sessionUsed, a.weeklyUsed);

export const resetClock = (a: Account) =>
  new Date(START + a.sessionResetsIn).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export type Switch = { from: string; to: string; auto: boolean };

export function useAccounts() {
  const [accounts, setAccounts] = useState(SAMPLE);
  const [defaults, setDefaults] = useState<Record<Provider, string>>({
    claude: "c-personal",
    codex: "x-personal",
  });
  const [thread, setThread] = useState({
    provider: "claude" as Provider,
    accountId: "c-personal",
  });
  const [autoSwitch, setAutoSwitch] = useState(true);
  // The composer's account control: hidden until the toolbar builder shows it.
  const [showAccount, setShowAccount] = useState(false);
  const [lastSwitch, setLastSwitch] = useState<Switch | null>(null);

  const of = (provider: Provider) =>
    accounts.filter((a) => a.provider === provider);
  const byId = (id: string) => accounts.find((a) => a.id === id);
  const patch = (id: string, change: Partial<Account>) =>
    setAccounts((all) => all.map((a) => (a.id === id ? { ...a, ...change } : a)));

  return {
    accounts,
    of,
    byId,
    defaults,
    thread,
    autoSwitch,
    lastSwitch,
    setAutoSwitch,
    showAccount,
    setShowAccount,
    makeDefault: (a: Account) =>
      setDefaults((d) => ({ ...d, [a.provider]: a.id })),
    rename: (id: string, label: string) => patch(id, { label }),
    use: (id: string) => {
      setLastSwitch({ from: thread.accountId, to: id, auto: false });
      setThread((t) => ({ ...t, accountId: id }));
    },
    setProvider: (provider: Provider) =>
      setThread({ provider, accountId: defaults[provider] }),
    add: (provider: Provider, label: string) => {
      const id = `${provider[0]}-${Date.now()}`;
      setAccounts((all) => [
        ...all,
        {
          id,
          provider,
          label,
          email: `you+${label.toLowerCase().replace(/\W+/g, "")}@sample.dev`,
          plan: provider === "claude" ? "Pro" : "Plus",
          sessionUsed: 0,
          weeklyUsed: 2,
          sessionResetsIn: 5 * hour,
          weeklyResetsIn: 160 * hour,
        },
      ]);
      return id;
    },
    remove: (a: Account) => {
      setAccounts((all) => all.filter((x) => x.id !== a.id));
      const fallback = of(a.provider).find((x) => x.id !== a.id)!.id;
      if (defaults[a.provider] === a.id)
        setDefaults((d) => ({ ...d, [a.provider]: fallback }));
      if (thread.accountId === a.id)
        setThread((t) => ({ ...t, accountId: fallback }));
    },
    /** Move an account up or down the order auto-switch follows. */
    move: (a: Account, by: -1 | 1) =>
      setAccounts((all) => {
        const mine = all.filter((x) => x.provider === a.provider);
        const at = mine.findIndex((x) => x.id === a.id);
        const to = at + by;
        if (to < 0 || to >= mine.length) return all;
        [mine[at], mine[to]] = [mine[to]!, mine[at]!];
        return [...all.filter((x) => x.provider !== a.provider), ...mine];
      }),
    /** Burn the thread's account to its limit, as a long answer would. */
    hitLimit: () => {
      const current = thread.accountId;
      patch(current, { sessionUsed: 100 });
      if (!autoSwitch) {
        setLastSwitch(null);
        return;
      }
      // Next one down the list with room, wrapping to the top. New threads
      // start there too, until you pick another.
      const list = of(thread.provider);
      const at = list.findIndex((a) => a.id === current);
      const next = [...list.slice(at + 1), ...list.slice(0, at)].find(
        (a) => headroom(a) > 0,
      );
      if (next) {
        setLastSwitch({ from: current, to: next.id, auto: true });
        setThread((t) => ({ ...t, accountId: next.id }));
        setDefaults((d) => ({ ...d, [thread.provider]: next.id }));
      } else setLastSwitch(null);
    },
    reset: () => {
      setAccounts(SAMPLE);
      setThread({ provider: "claude", accountId: "c-personal" });
      setDefaults({ claude: "c-personal", codex: "x-personal" });
      setLastSwitch(null);
    },
    clearSwitch: () => setLastSwitch(null),
  };
}
export type Accounts = ReturnType<typeof useAccounts>;
