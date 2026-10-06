import { beforeEach, expect, it, vi } from "vitest";
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

it("keeps a thread on its account, and moves one whose account is gone to the one in use", async () => {
  const accounts = new AgentAccounts(
    fakeStore({ ...three, inUse: { claude: "work" } }),
    () => {},
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
  const accounts = new AgentAccounts(fakeStore(three), () => {});
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
