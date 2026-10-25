import { describe, expect, it } from "vitest";
import { Gitea, giteaMergeMethods } from "./gitea";

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

it("retries a refused write once with the new credential and the same JSON body", async () => {
  const sent: RequestInit[] = [];
  const gitea = new Gitea(account, "expired", async (_url, init) => {
    sent.push(init);
    return new Headers(init.headers).get("authorization") === "token fresh"
      ? Response.json({ id: 42 })
      : new Response("", { status: 401 });
  });
  gitea.renewToken = async () => "fresh";
  expect(
    (
      await gitea.request("/repos/o/r/issues/7/comments", {
        method: "POST",
        body: { body: "comment" },
      })
    ).data,
  ).toEqual({ id: 42 });
  expect(
    sent.map((init) => ({
      method: init.method,
      body: init.body,
      type: new Headers(init.headers).get("content-type"),
      authorization: new Headers(init.headers).get("authorization"),
    })),
  ).toEqual(
    ["expired", "fresh"].map((token) => ({
      method: "POST",
      body: '{"body":"comment"}',
      type: "application/json",
      authorization: `token ${token}`,
    })),
  );
  expect(sent[0]!.signal).toBe(sent[1]!.signal);
});

it("doesn't renew more than once or retry a write after an ambiguous failure", async () => {
  for (const failure of [401, 500, "network"] as const) {
    let asked = 0;
    let sent = 0;
    const gitea = new Gitea(account, "expired", async () => {
      sent++;
      if (failure === "network") throw new Error("fetch failed");
      return new Response("", { status: failure });
    });
    gitea.renewToken = async () => {
      asked++;
      return "fresh";
    };
    await expect(
      gitea.comment({ owner: "o", name: "r", number: 7 }, "comment"),
    ).rejects.toThrow();
    expect(asked).toBe(failure === 401 ? 1 : 0);
    expect(sent).toBe(failure === 401 ? 2 : 1);
  }
});

it("offers Gitea's allowed merge methods with the repository's default first", () => {
  expect(
    giteaMergeMethods({
      allow_merge_commits: true,
      allow_squash_merge: true,
      allow_rebase: false,
      default_merge_style: "squash",
    }),
  ).toEqual(["squash", "merge"]);
  // A rebase-merge or fast-forward default isn't one Relay offers; the order stays.
  expect(giteaMergeMethods({ default_merge_style: "rebase-merge" })).toEqual([
    "merge",
    "squash",
    "rebase",
  ]);
});

/** A Gitea that answers from `routes`, keyed by method and API path without the query. */
function routed(routes: Record<string, () => Response>) {
  const fetch = async (url: string, options: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/v1", "");
    const route = routes[`${options.method ?? "GET"} ${path}`];
    return route ? route() : new Response("{}", { status: 404 });
  };
  const gitea = new Gitea(account, "token", fetch);
  gitea.mergeableRechecks = [0, 0];
  return gitea;
}
const ref = { owner: "o", name: "r", number: 7 };
const pr = (mergeable: boolean) =>
  Response.json({
    mergeable,
    draft: false,
    base: { ref: "main" },
    merge_base: "m",
  });

it("asks again while Gitea is still checking a PR, and believes a no that lasts", async () => {
  const answers = [false, true];
  const checking = routed({
    "GET /repos/o/r/pulls/7": () => pr(answers.shift() ?? true),
    "GET /repos/o/r": () => Response.json({}),
  });
  expect((await checking.mergeReadiness(ref)).status).toBe("clean");

  let asked = 0;
  const conflicted = routed({
    "GET /repos/o/r/pulls/7": () => (asked++, pr(false)),
    "GET /repos/o/r": () => Response.json({}),
  });
  expect((await conflicted.mergeReadiness(ref)).status).toBe("conflicts");
  expect(asked).toBe(3);
});

it.each([
  [409, { message: "head out of date" }, "A new commit arrived. Refresh before merging."],
  [409, { Style: "squash", StdErr: "CONFLICT (content)" }, "It conflicts with the base branch now."],
  [405, { message: "User not allowed to merge PR" }, "Gitea refused this: User not allowed to merge PR"],
])("says why Gitea refused a merge (%i %j)", async (status, body, said) => {
  const gitea = routed({
    "POST /repos/o/r/pulls/7/merge": () => Response.json(body, { status }),
  });
  await expect(gitea.merge(ref, "h", "squash")).rejects.toThrow(said);
});
