import { describe, expect, it } from "vitest";
import { Gitea } from "./gitea";

const account = {
  id: "https://git.example.com#7",
  server: "https://git.example.com",
  user: { id: 7, login: "vilem" },
  persistent: true,
};

/** A server that takes only `valid` and records the token of every request. */
function server(valid: () => string) {
  const seen: string[] = [];
  const fetch = async (_url: string, options: RequestInit) => {
    const token = String(
      (options.headers as Record<string, string>).Authorization,
    ).replace(/^token /, "");
    seen.push(token);
    return token === valid()
      ? new Response('{"ok":true}', { status: 200 })
      : new Response("", { status: 401 });
  };
  return { seen, fetch };
}

describe("a refused Gitea token", () => {
  it("is renewed once for all the requests refused together, which then go through", async () => {
    let current = "fresh";
    const { seen, fetch } = server(() => current);
    const gitea = new Gitea(account, "expired", fetch);
    let asked = 0;
    gitea.renewToken = async () => {
      asked++;
      return current;
    };
    const results = await Promise.all([
      gitea.request("/user"),
      gitea.request("/repos"),
      gitea.request("/orgs"),
    ]);
    expect(results.map((r) => r.data)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ]);
    expect(asked).toBe(1);
    // Later requests start with the renewed token.
    seen.length = 0;
    await gitea.request("/user");
    expect(seen).toEqual(["fresh"]);
    // And it renews again when that one expires in turn.
    current = "fresher";
    await gitea.request("/user");
    expect(asked).toBe(2);
  });

  it("still fails when the renewed token is the same or renewing fails", async () => {
    const { seen, fetch } = server(() => "never");
    const gitea = new Gitea(account, "expired", fetch);
    gitea.renewToken = async () => "expired";
    await expect(gitea.request("/user")).rejects.toThrow(
      "Your token is invalid or expired",
    );
    expect(seen).toEqual(["expired"]);
    gitea.renewToken = () => Promise.reject(new Error("tea isn't there"));
    await expect(gitea.request("/user")).rejects.toThrow(
      "Your token is invalid or expired",
    );
  });
});
