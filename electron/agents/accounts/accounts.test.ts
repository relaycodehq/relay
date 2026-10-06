import { beforeEach, expect, it, vi } from "vitest";
import type { ProviderUsage } from "../../../shared/provider-usage";
import type { StoredAccounts } from "../../../shared/agent-accounts";
import type { Store } from "../../app/store";

const signedIn = new Set<string>();
vi.mock("./identity", () => ({
  readIdentity: async (provider: string, id: string) => ({
    signedIn: signedIn.has(`${provider}:${id}`),
  }),
}));
vi.mock("./profiles", () => ({
  accountEnv: () => ({}),
  prepareProfile: async () => "",
  removeProfile: async () => {},
  setProfilesRoot: () => {},
  usualHome: (provider: string) => `/home/.${provider}`,
  profileDir: (provider: string, id: string) => `/profiles/${provider}/${id}`,
}));
const { AgentAccounts, accountFor, accountHomes } = await import(".");

function fakeStore(saved: StoredAccounts) {
  let state = { agentAccounts: saved } as ReturnType<Store["get"]>;
  return {
    get: () => state,
    update: async (fn: (s: typeof state) => void) => {
      const next = structuredClone(state);
      fn(next);
      state = next;
    },
  } as unknown as Store;
}
const usage =
  (used: Record<string, number>) =>
  async (provider: "claude" | "codex", id: string): Promise<ProviderUsage> => ({
    provider,
    message: null,
    windows: [
      {
        kind: "session",
        usedPercent: used[id] ?? 0,
        resetsAt: null,
        periodMs: 1,
      },
    ],
  });
const three: StoredAccounts = {
  accounts: [
    { provider: "claude", id: "default", label: "Personal" },
    { provider: "claude", id: "work", label: "Work" },
    { provider: "claude", id: "client", label: "Client" },
  ],
};

beforeEach(() => {
  signedIn.clear();
  for (const id of ["default", "work", "client"]) signedIn.add(`claude:${id}`);
});

it("moves on down the list to the first account with room, and puts it in use", async () => {
  const accounts = new AgentAccounts(
    fakeStore(three),
    () => {},
    usage({ work: 100 }),
  );
  expect(await accounts.moveOn("claude", "default", undefined)).toBe("client");
  expect(accountFor("claude")).toBe("client");
});

it("wraps to the top, skipping signed-out accounts", async () => {
  signedIn.delete("claude:work");
  const accounts = new AgentAccounts(fakeStore(three), () => {}, usage({}));
  expect(await accounts.moveOn("claude", "client", undefined)).toBe("default");
});

it("doesn't bounce an answer between accounts that have both run out", async () => {
  const two: StoredAccounts = { accounts: three.accounts.slice(0, 2) };
  // Usage that lags behind: neither reads as spent yet.
  const accounts = new AgentAccounts(fakeStore(two), () => {}, usage({}));
  expect(await accounts.moveOn("claude", "default", Date.now() + 60_000)).toBe(
    "work",
  );
  expect(
    await accounts.moveOn("claude", "work", Date.now() + 60_000),
  ).toBeUndefined();
});

it("waits for the reset when auto-switch is off", async () => {
  const accounts = new AgentAccounts(
    fakeStore({ ...three, autoSwitch: false }),
    () => {},
    usage({}),
  );
  expect(await accounts.moveOn("claude", "default", undefined)).toBeUndefined();
  expect(accountFor("claude")).toBe("default");
});

it("keeps a thread on its account, and moves one whose account is gone to the one in use", async () => {
  const accounts = new AgentAccounts(
    fakeStore({ ...three, inUse: { claude: "work" } }),
    () => {},
    usage({}),
  );
  expect(accountFor("claude", "client")).toBe("client");
  await accounts.remove("claude", "client");
  expect(accountFor("claude", "client")).toBe("work");
  await accounts.remove("claude", "work");
  // The usual sign-in is always there, and takes over what was in use.
  expect(accountFor("claude")).toBe("default");
  expect(accountFor("codex")).toBe("default");
});

it("lists the usual sign-in's folder first however the accounts are ordered", async () => {
  const accounts = new AgentAccounts(fakeStore(three), () => {}, usage({}));
  await accounts.move("claude", "default", 1);
  await accounts.move("claude", "default", 1);
  expect(
    accounts
      .list()
      .filter((a) => a.provider === "claude")
      .map((a) => a.id),
  ).toEqual(["work", "client", "default"]);
  expect(
    accountHomes()
      .filter((h) => h.provider === "claude")
      .map((h) => h.home),
  ).toEqual(["/home/.claude", "/profiles/claude/work", "/profiles/claude/client"]);
});
