import { afterEach, expect, it, vi } from "vitest";
import { readProviderUsage } from "../../electron/provider-usage";

// As on Windows: paths join with backslashes and nothing is in a keychain.
vi.mock("node:path", async () => (await vi.importActual("node:path")).win32);
vi.mock("node:os", async (actual) => ({
  ...(await actual<typeof import("node:os")>()),
  homedir: () => "C:\\Users\\me",
}));
const files = new Map<string, string>();
vi.mock("node:fs/promises", () => ({
  stat: async (path: string) => {
    const text = files.get(path);
    if (text === undefined) throw new Error("ENOENT");
    return { isFile: () => true, size: text.length, mode: 0o600 };
  },
  readFile: async (path: string) => files.get(path),
  writeFile: async (path: string, text: string) => void files.set(path, text),
  rename: async (from: string, to: string) => {
    files.set(to, files.get(from)!);
    files.delete(from);
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

it("keeps the tokens a refresh rotated in the Codex CLI's Windows auth file", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.stubEnv("CODEX_HOME", "");
  const auth = "C:\\Users\\me\\.codex\\auth.json";
  const expired = jwt(Math.floor(Date.now() / 1000) - 60);
  const fresh = jwt(Math.floor(Date.now() / 1000) + 3600);
  files.set(
    auth,
    JSON.stringify({
      tokens: { access_token: expired, refresh_token: "spent-after-use" },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      if (url.href === "https://auth.openai.com/oauth/token")
        return Response.json({ access_token: fresh, refresh_token: "next" });
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${fresh}`,
      );
      return Response.json({
        rate_limit: {
          primary_window: { used_percent: 12, limit_window_seconds: 18_000 },
        },
      });
    }),
  );
  const usage = await readProviderUsage("codex");
  // The refresh token was used up; losing its successor signs the CLI out.
  expect(JSON.parse(files.get(auth)!).tokens).toEqual({
    access_token: fresh,
    refresh_token: "next",
  });
  expect(usage.windows.map((w) => w.usedPercent)).toEqual([12]);
});
