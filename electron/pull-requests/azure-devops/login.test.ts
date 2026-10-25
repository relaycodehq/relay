import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AzureCliTokens } from "../../azure-devops/cli-token";
import { AzureLogin } from "./login";

const az = vi.hoisted(() => ({
  token: "old-login" as string | null,
  /** What a failing `az` prints, other than having no login. */
  failure: undefined as string | undefined,
  asked: [] as string[][],
}));

vi.mock("../../platform/executables", () => ({
  findExecutable: async () => "az",
}));

vi.mock("node:child_process", () => ({
  execFile: (
    _file: string,
    args: string[],
    _options: unknown,
    done: (error: Error | null, result?: { stdout: string }) => void,
  ) => {
    az.asked.push(args);
    if (az.failure)
      return done(
        Object.assign(new Error(`Command failed: az\n${az.failure}`), {
          stderr: az.failure,
        }),
      );
    if (!az.token)
      return done(new Error("Please run 'az login' to setup account."));
    done(null, {
      stdout: JSON.stringify({
        accessToken: az.token,
        expires_on: Date.now() / 1000 + 3600,
      }),
    });
  },
}));

const org = "https://dev.azure.com/sample-org";
const tenant = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  az.token = "old-login";
  az.failure = undefined;
  az.asked = [];
});

afterEach(() => vi.useRealTimers());

type Failure = number | "network" | "sign-in page";

/** Azure's refusals of a sign-in come as a 401, or as a sign-in page: a 203 or a plain 200. */
const failed = (failure: Exclude<Failure, "network">) =>
  failure === 203 || failure === "sign-in page"
    ? new Response("<html>Sign in</html>", {
        status: failure === 203 ? 203 : 200,
        headers: { "content-type": "text/html" },
      })
    : Response.json({ message: "nope" }, { status: failure });

function server() {
  const seen: string[] = [];
  const state = {
    failure: undefined as Failure | undefined,
    hold: undefined as Promise<Response> | undefined,
  };
  const tokens = new AzureCliTokens(
    async () =>
      new Response(null, { headers: { "x-vss-resourcetenant": tenant } }),
  );
  const login = new AzureLogin(async (url, init) => {
    seen.push(new Headers(init.headers).get("authorization")!);
    if (url.endsWith("/held") && state.hold) return state.hold;
    if (state.failure === "network") throw new TypeError("fetch failed");
    if (state.failure !== undefined) return failed(state.failure);
    const bob = seen.at(-1) === "Bearer bob-login";
    return Response.json({
      authenticatedUser: bob
        ? {
            id: "me-2",
            providerDisplayName: "Bob Example",
            properties: { Account: { $value: "bob@example.com" } },
          }
        : {
            id: "me-1",
            providerDisplayName: "Ann Example",
            properties: { Account: { $value: "ann@example.com" } },
          },
      value: [],
    });
  }, tokens);
  return { login, tokens, seen, state };
}

it.each([401, 203, "sign-in page"] as const)(
  "picks up a new az login on the next operation after Azure answers %s",
  async (failure) => {
    const { login, seen, state } = server();
    const old = await login.require(org);
    expect(az.asked[0]).toEqual(expect.arrayContaining(["--tenant", tenant]));
    state.failure = failure;
    await expect(old.request(`${org}/_apis/git/pullrequests`)).rejects.toThrow(
      /az login/,
    );
    expect(seen).toEqual(["Bearer old-login", "Bearer old-login"]);

    az.token = "new-login";
    state.failure = undefined;
    const fresh = await login.require(org);
    expect(fresh).not.toBe(old);
    await fresh.request(`${org}/_apis/git/pullrequests`);
    expect(seen.slice(2)).toEqual(["Bearer new-login", "Bearer new-login"]);
    // A review still holding the refused client recovers too.
    await old.request(`${org}/_apis/git/pullrequests`);
    expect(seen.at(-1)).toBe("Bearer new-login");
    expect(az.asked).toHaveLength(2);
  },
);

it.each(["network", 403, 429, 500] as const)(
  "keeps the client and its token on %s",
  async (failure) => {
    const { login, seen, state } = server();
    const client = await login.require(org);
    state.failure = failure;
    const error = await client.request(`${org}/_apis/git/pullrequests`).then(
      () => null,
      (e: Error) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toMatch(/az login/);
    state.failure = undefined;
    expect(await login.require(org)).toBe(client);
    await client.request(`${org}/_apis/git/pullrequests`);
    expect(seen.at(-1)).toBe("Bearer old-login");
    expect(az.asked).toHaveLength(1);
  },
);

it("doesn't let a late refusal of the old token discard the new login", async () => {
  const { login, seen, state } = server();
  const old = await login.require(org);
  let finish!: (response: Response) => void;
  state.hold = new Promise((resolve) => {
    finish = resolve;
  });
  const late = expect(old.request(`${org}/held`)).rejects.toThrow(/az login/);
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  state.failure = 401;
  await expect(old.request(`${org}/_apis/git/pullrequests`)).rejects.toThrow(
    /az login/,
  );

  az.token = "new-login";
  state.failure = undefined;
  const fresh = await login.require(org);
  finish(failed(401));
  await late;
  expect(await login.require(org)).toBe(fresh);
  await fresh.request(`${org}/_apis/git/pullrequests`);
  expect(seen.at(-1)).toBe("Bearer new-login");
  expect(az.asked).toHaveLength(2);
});

it("doesn't let a refusal from before the sign-in settings changed discard the token after", async () => {
  const { login, seen, state, tokens } = server();
  const client = await login.require(org);
  let finish!: (response: Response) => void;
  state.hold = new Promise((resolve) => {
    finish = resolve;
  });
  const late = expect(client.request(`${org}/held`)).rejects.toThrow(
    /az login/,
  );
  await vi.waitFor(() => expect(seen).toHaveLength(2));
  // Work items share the `az` tokens and forget them when their settings change.
  // `az` hands out the same token again, so only the change tells them apart.
  tokens.forget();
  await client.request(`${org}/_apis/git/pullrequests`);
  expect(az.asked).toHaveLength(2);

  finish(failed(401));
  await late;
  expect(await login.require(org)).toBe(client);
  await client.request(`${org}/_apis/git/pullrequests`);
  expect(seen.at(-1)).toBe("Bearer old-login");
  expect(az.asked).toHaveLength(2);
});

it("asks who it is again after 5 minutes, and the old client's refusal then leaves the new one", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { login, state } = server();
  const old = await login.require(org);
  vi.setSystemTime(Date.now() + 4 * 60_000);
  expect(await login.require(org)).toBe(old);
  vi.setSystemTime(Date.now() + 2 * 60_000);
  const fresh = await login.require(org);
  expect(fresh).not.toBe(old);

  state.failure = 401;
  await expect(old.request(`${org}/_apis/git/pullrequests`)).rejects.toThrow(
    /az login/,
  );
  state.failure = undefined;
  expect(await login.require(org)).toBe(fresh);
});

it("keeps a client per organization", async () => {
  const { login } = server();
  const one = await login.require(org);
  const other = await login.require("https://dev.azure.com/other-org");
  expect(other).not.toBe(one);
  expect(await login.require(org)).toBe(one);
});

it("reads no az login as signed out, and finds the account once you sign in", async () => {
  const { login } = server();
  az.token = null;
  await expect(login.account(org)).resolves.toBeNull();
  az.token = "new-login";
  await expect(login.account(org)).resolves.toMatchObject({
    server: org,
    user: { login: "ann@example.com", full_name: "Ann Example" },
  });
  expect(az.asked).toHaveLength(2);
});

it("doesn't pass az failing to reach Entra off as signed out", async () => {
  const { login } = server();
  az.failure =
    "ERROR: HTTPSConnectionPool(host='login.microsoftonline.com', port=443): Max retries exceeded";
  await expect(login.account(org)).rejects.toThrow(/Max retries exceeded/);
  az.failure = undefined;
  await expect(login.account(org)).resolves.toMatchObject({ server: org });
});

it("doesn't run a signed-out az on every request, but checking again does", async () => {
  const { tokens, login } = server();
  az.token = null;
  await expect(tokens.token(org)).rejects.toThrow(/az login/);
  await expect(tokens.token(org)).rejects.toThrow(/az login/);
  expect(az.asked).toHaveLength(1);
  az.token = "new-login";
  await expect(login.account(org)).resolves.toMatchObject({ server: org });
  expect(az.asked).toHaveLength(2);
});

it.each(["network", 500] as const)(
  "doesn't pass an Azure DevOps that answers %s off as signed out",
  async (failure) => {
    const { login, state } = server();
    state.failure = failure;
    await expect(login.account(org)).rejects.toThrow();
    state.failure = undefined;
    await expect(login.account(org)).resolves.toMatchObject({ server: org });
  },
);

it("starts over once Azure DevOps is turned off", async () => {
  const { login } = server();
  const before = await login.require(org);
  login.release();
  expect(await login.require(org)).not.toBe(before);
});

it("acts as the new az login once work items let the old token go", async () => {
  const { login, tokens } = server();
  const ann = await login.require(org);
  // Work items forget the shared tokens; `az` is signed in as someone else now.
  az.token = "bob-login";
  tokens.forget();
  const bob = await login.require(org);
  expect(bob).not.toBe(ann);
  expect(bob.account.user.login).toBe("bob@example.com");
});

it("checking again asks az, so a login made since shows without a refusal", async () => {
  const { login } = server();
  await expect(login.account(org)).resolves.toMatchObject({
    user: { login: "ann@example.com" },
  });
  az.token = "bob-login";
  await expect(login.account(org)).resolves.toMatchObject({
    user: { login: "bob@example.com" },
  });
});

it("asks for an organization's tenant again after an answer without it", async () => {
  let answers = 0;
  const tokens = new AzureCliTokens(async () =>
    ++answers === 1
      ? new Response(null, { status: 503 })
      : new Response(null, { headers: { "x-vss-resourcetenant": tenant } }),
  );
  await tokens.token(org);
  expect(az.asked[0]).not.toContain("--tenant");
  await tokens.renew(org);
  await tokens.token(org);
  expect(az.asked.at(-1)).toEqual(expect.arrayContaining(["--tenant", tenant]));
});
