import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { readProviderUsage } from "./provider-usage";

// No auth file anywhere: the Codex CLI keeps its sign-in in the Keychain.
vi.mock("node:fs/promises", () => ({
  stat: async () => {
    throw new Error("ENOENT");
  },
  readFile: async () => {
    throw new Error("ENOENT");
  },
  realpath: async () => {
    throw new Error("ENOENT");
  },
}));

type Item = { service: string; account: string; value: string };
const keychain: Item[] = [];

/** `security` on a Keychain of `keychain`'s generic passwords. */
vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: object,
    done: (error: Error | null, out?: { stdout: string }) => void,
  ) => {
    const flag = (name: string) => {
      const at = args.indexOf(name);
      return at < 0 ? undefined : args[at + 1];
    };
    const service = flag("-s");
    const account = flag("-a");
    const matches = (item: Item) =>
      item.service === service &&
      (account === undefined || item.account === account);
    if (args[0] === "find-generic-password") {
      const item = keychain.find(matches);
      if (!item) return done(new Error("not found"));
      return done(null, { stdout: item.value });
    }
    // add-generic-password -U updates the item with this service and account.
    const value = flag("-w")!;
    const item = keychain.find(
      (i) => i.service === service && i.account === (account ?? ""),
    );
    if (item) item.value = value;
    else keychain.push({ service: service!, account: account ?? "", value });
    done(null, { stdout: "" });
  },
}));

const platform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: platform });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const jwt = (exp: number) =>
  [
    "header",
    Buffer.from(JSON.stringify({ exp })).toString("base64url"),
    "sig",
  ].join(".");

/** Codex's `compute_store_key`: the home folder's path, hashed. */
const cliAccount = (home: string) =>
  `cli|${createHash("sha256").update(home).digest("hex").slice(0, 16)}`;

it("keeps the tokens a refresh rotated in the Codex CLI's own Keychain item", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  vi.stubEnv("CODEX_HOME", "/nowhere/.codex");
  const expired = jwt(Math.floor(Date.now() / 1000) - 60);
  const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
  // Another Codex home's sign-in, the item `security` finds first.
  const otherHome = {
    service: "Codex Auth",
    account: cliAccount("/elsewhere/.codex"),
    value: JSON.stringify({
      tokens: { access_token: expired, refresh_token: "not-ours" },
    }),
  };
  keychain.push(otherHome, {
    service: "Codex Auth",
    account: cliAccount("/nowhere/.codex"),
    value: JSON.stringify({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: {
        id_token: "old-id",
        access_token: expired,
        refresh_token: "spent-after-use",
        account_id: "acct-1",
      },
      last_refresh: "2026-11-01T00:00:00Z",
    }),
  });
  const fetch = vi.fn(async (url: URL, _init?: RequestInit) => {
    if (url.href === "https://auth.openai.com/oauth/token")
      return Response.json({ access_token: fresh, refresh_token: "next" });
    return Response.json({
      rate_limit: {
        primary_window: { used_percent: 12, limit_window_seconds: 18_000 },
      },
    });
  });
  vi.stubGlobal("fetch", fetch);

  const usage = await readProviderUsage("codex");

  // A second item would leave the CLI the spent refresh token, signing it out.
  expect(keychain).toHaveLength(2);
  expect(keychain[0]).toEqual(otherHome);
  const saved = JSON.parse(keychain[1].value);
  expect(saved).toMatchObject({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      id_token: "old-id",
      access_token: fresh,
      refresh_token: "next",
      account_id: "acct-1",
    },
  });
  expect(saved.last_refresh).not.toBe("2026-11-01T00:00:00Z");
  const refresh = fetch.mock.calls.find(
    ([url]) => url.href === "https://auth.openai.com/oauth/token",
  );
  expect(String(refresh?.[1]?.body)).toContain("spent-after-use");
  expect(usage.windows.map((w) => w.usedPercent)).toEqual([12]);
});
