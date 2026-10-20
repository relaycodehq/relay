import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GitHub, GithubSignedOut } from "../pull-requests/github";
import { GithubLogin } from "./login";

const gh = vi.hoisted(() => ({ token: "old-login", asked: 0 }));
vi.mock("../platform/executables", () => ({
  findExecutable: async () => "gh",
}));
vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    done: (error: Error | null, result: { stdout: string }) => void,
  ) => {
    gh.asked++;
    done(null, { stdout: gh.token });
  },
}));

beforeEach(() => {
  gh.token = "old-login";
  gh.asked = 0;
});
afterEach(() => vi.restoreAllMocks());

const login = () =>
  new GithubLogin(async () => new Response("{}", { status: 500 }));

it("reads no `gh` login as signed out", async () => {
  vi.spyOn(GitHub, "connect").mockRejectedValue(new GithubSignedOut());
  await expect(login().account()).resolves.toBeNull();
});

it("doesn't pass a GitHub that didn't answer off as signed out", async () => {
  vi.spyOn(GitHub, "connect").mockRejectedValue(new Error("fetch failed"));
  await expect(login().account()).rejects.toThrow("fetch failed");
});

function server() {
  const seen: string[] = [];
  const state = {
    failure: undefined as number | "network" | undefined,
    hold: undefined as Promise<Response> | undefined,
  };
  const login = new GithubLogin(async (url, init) => {
    seen.push(new Headers(init.headers).get("authorization")!);
    if (url.endsWith("/held") && state.hold) return state.hold;
    if (state.failure === "network") throw new TypeError("fetch failed");
    if (state.failure !== undefined)
      return new Response("{}", { status: state.failure });
    return Response.json({ id: 1, login: "sample", ok: true });
  });
  return { login, seen, state };
}

it("picks up a new gh login on the next operation after GitHub refuses the cached client", async () => {
  const { login, seen, state } = server();
  const old = await login.require();
  state.failure = 401;
  await expect(
    old.request("/repos", { method: "POST", body: {} }),
  ).rejects.toThrow(/gh auth login/);
  expect(seen).toEqual(["Bearer old-login", "Bearer old-login"]);
  gh.token = "new-login";
  state.failure = undefined;
  const fresh = await login.require();
  await fresh.request("/repos");
  expect(seen.slice(-2)).toEqual(["Bearer new-login", "Bearer new-login"]);
  expect(gh.asked).toBe(2);
});

it.each(["network", 403, 429, 500] as const)(
  "keeps the gh client on %s",
  async (failure) => {
    const { login, state } = server();
    const client = await login.require();
    state.failure = failure;
    await expect(client.request("/repos")).rejects.toThrow();
    state.failure = undefined;
    expect(await login.require()).toBe(client);
    expect(gh.asked).toBe(1);
  },
);

it("doesn't let a late 401 from the old gh client discard its replacement", async () => {
  const { login, seen, state } = server();
  const old = await login.require();
  let finish!: (response: Response) => void;
  state.hold = new Promise((resolve) => {
    finish = resolve;
  });
  const late = expect(old.request("/held")).rejects.toThrow(/gh auth login/);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  state.failure = 401;
  await expect(old.request("/repos")).rejects.toThrow(/gh auth login/);
  gh.token = "new-login";
  state.failure = undefined;
  const fresh = await login.require();
  finish(new Response("{}", { status: 401 }));
  await late;
  expect(await login.require()).toBe(fresh);
  expect(gh.asked).toBe(2);
});
