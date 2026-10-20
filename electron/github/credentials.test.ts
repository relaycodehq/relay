import { afterEach, expect, it, vi } from "vitest";
import { GithubCredentials } from "./credentials";
import { GithubLogin } from "./login";
import { GitHub } from "../ci/github";

const repo = { owner: "fixture", name: "repo" };
afterEach(() => vi.restoreAllMocks());
function services() {
  const state = { token: "a", failure: 0 };
  const source = vi.fn(async () => state.token);
  const credentials = new GithubCredentials(source);
  const seen: { token: string | null; etag: string | null }[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen.push({
      token: headers.get("authorization"),
      etag: headers.get("if-none-match"),
    });
    if (state.failure) return new Response(null, { status: state.failure });
    return url.endsWith("/user")
      ? Response.json({ id: 1, login: state.token })
      : Response.json(
          { default_branch: state.token },
          { headers: { etag: `"${state.token}"` } },
        );
  });
  return {
    state,
    source,
    seen,
    fetch,
    login: new GithubLogin(fetch, credentials),
    ci: new GitHub(fetch, credentials),
  };
}

it("shares one CLI lookup and renews both services after an external account change", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  const s = services();
  expect((await s.login.account())?.user.login).toBe("a");
  expect(await s.ci.defaultBranch(repo)).toBe("a");
  expect(s.source).toHaveBeenCalledTimes(1);
  s.state.token = "b";
  clock.mockReturnValue(1_000_000 + 5 * 60_000);
  expect((await s.login.account())?.user.login).toBe("b");
  expect(await s.ci.defaultBranch(repo)).toBe("b");
  expect(s.seen.slice(-2)).toEqual([
    { token: "Bearer b", etag: null },
    { token: "Bearer b", etag: null },
  ]);
  expect(s.source).toHaveBeenCalledTimes(2);
});

it.each(["pr", "ci"])(
  "renews both callers after %s rejects the shared credential",
  async (caller) => {
    const s = services();
    const client = await s.login.require();
    await s.ci.defaultBranch(repo);
    s.state.failure = 401;
    await expect(
      caller === "pr" ? client.request("/repos") : s.ci.defaultBranch(repo),
    ).rejects.toThrow(/gh login/);
    s.state.token = "b";
    s.state.failure = 0;
    expect(await s.ci.defaultBranch(repo)).toBe("b");
    expect((await s.login.account())?.user.login).toBe("b");
    expect(s.source).toHaveBeenCalledTimes(2);
  },
);

it("a Settings recheck renews CI as well as PRs without waiting for expiry", async () => {
  const s = services();
  await s.ci.defaultBranch(repo);
  s.state.token = "b";
  s.login.refresh();
  expect(await s.ci.defaultBranch(repo)).toBe("b");
  expect((await s.login.account())?.user.login).toBe("b");
  expect(s.source).toHaveBeenCalledTimes(2);
});

it.each([403, 429, 500])(
  "keeps the credential after HTTP %i",
  async (status) => {
    const s = services();
    const client = await s.login.require();
    s.state.failure = status;
    await expect(s.ci.defaultBranch(repo)).rejects.toThrow();
    s.state.failure = 0;
    expect(await s.login.require()).toBe(client);
    expect(s.source).toHaveBeenCalledTimes(1);
  },
);
