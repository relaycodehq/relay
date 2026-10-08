import { expect, it } from "vitest";
import { GitHub, searchQuery } from "./github";
import { parseGithubPullUrl } from "../../shared/validation";

const ref = { owner: "o", name: "r", number: 7 };
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });

/** A GitHub that answers from `routes`, keyed by method and path without the query. */
function github(
  routes: Record<string, (body: any, url: URL) => Response>,
  sent: { path: string; body: any }[] = [],
) {
  return new GitHub(
    {
      id: "https://github.com",
      server: "https://github.com",
      user: { id: 1, login: "me" },
      persistent: true,
    },
    "token",
    async (url, options) => {
      const u = new URL(url);
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      sent.push({ path: u.pathname, body });
      const route = routes[`${options.method} ${u.pathname}`];
      if (!route) return new Response("{}", { status: 404 });
      return route(body, u);
    },
  );
}

const pull = {
  number: 7,
  id: 70,
  title: "t",
  body: null,
  state: "open",
  draft: false,
  merged: false,
  merged_at: null,
  html_url: "https://github.com/o/r/pull/7",
  head: { ref: "f", sha: "h".repeat(40), repo: null },
  base: { ref: "main", sha: "b".repeat(40), repo: null },
  user: { id: 2, login: "them" },
  updated_at: "",
  labels: [],
};

it("gives a pull its merge base from a compare, and names github.com as its server", async () => {
  const client = github({
    "GET /repos/o/r/pulls/7": () => json(pull),
    [`GET /repos/o/r/compare/${"b".repeat(40)}...${"h".repeat(40)}`]: () =>
      json({ merge_base_commit: { sha: "m".repeat(40) } }),
  });
  const p = await client.pull(ref);
  expect(p.merge_base).toBe("m".repeat(40));
  expect(p.body).toBe("");
  expect(p.server).toBe("https://github.com");
});

it("speaks Gitea's file statuses and review verdicts", async () => {
  const client = github({
    "GET /repos/o/r/pulls/7/files": () =>
      json([{ filename: "a", status: "removed", additions: 0, deletions: 1 }]),
    "GET /repos/o/r/pulls/7/reviews": () =>
      json([
        { id: 1, state: "CHANGES_REQUESTED", body: "" },
        { id: 2, state: "DISMISSED", body: "" },
      ]),
  });
  expect((await client.files(ref, 1)).items[0]!.status).toBe("deleted");
  const reviews = (await client.reviews(ref, 1)).items;
  expect(reviews[0]!.state).toBe("REQUEST_CHANGES");
  expect(reviews[1]).toMatchObject({ state: "COMMENT", dismissed: true });
});

it("puts a review's comments on the side and line they were left on, resolved by thread", async () => {
  const client = github({
    "GET /repos/o/r/pulls/7/comments": () =>
      json([
        {
          id: 10,
          pull_request_review_id: 5,
          path: "a",
          side: "RIGHT",
          line: 4,
          original_line: 4,
        },
        {
          id: 11,
          pull_request_review_id: 5,
          path: "b",
          side: "LEFT",
          line: 9,
          original_line: 9,
        },
        {
          id: 12,
          pull_request_review_id: 6,
          path: "c",
          side: "RIGHT",
          line: 1,
          original_line: 1,
        },
      ]),
    "POST /graphql": () =>
      json({
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [
                  {
                    id: "T1",
                    isResolved: true,
                    resolvedBy: { login: "me", databaseId: 1 },
                    comments: { nodes: [{ databaseId: 11 }] },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }),
  });
  const comments = await client.reviewComments(ref, 5);
  expect(comments.map((c) => c.id)).toEqual([10, 11]);
  expect(comments[0]).toMatchObject({
    position: 4,
    original_position: 0,
    resolver: null,
  });
  expect(comments[1]).toMatchObject({
    position: 0,
    original_position: 9,
    resolver: { login: "me" },
  });
});

it("submits drafts by line and side, with GitHub's name for approving", async () => {
  const sent: { path: string; body: any }[] = [];
  const merge = "m".repeat(40),
    head = "h".repeat(40);
  const client = github(
    {
      "GET /repos/o/r/pulls/7": () => json(pull),
      [`GET /repos/o/r/compare/${"b".repeat(40)}...${head}`]: () =>
        json({ merge_base_commit: { sha: merge } }),
      "GET /repos/o/r/pulls/7/reviews": () => json([]),
      "POST /repos/o/r/pulls/7/reviews": () =>
        json({ id: 3, state: "APPROVED", body: "" }),
    },
    sent,
  );
  await client.submit(ref, head, "APPROVED", "ok", [
    {
      id: "d",
      path: "a",
      line: 3,
      side: "deletions",
      body: "x",
      revision: `${merge}:${head}`,
      createdAt: "",
    },
  ]);
  expect(sent.at(-1)!.body).toMatchObject({
    event: "APPROVE",
    commit_id: head,
    comments: [{ path: "a", line: 3, side: "LEFT", body: "x" }],
  });
});

it("says what changed between two commits only when one follows the other", async () => {
  const answer = {
    status: "ahead",
    files: [{ filename: "b", previous_filename: "a" }],
  };
  const client = github({
    "GET /repos/o/r/compare/x...y": () => json(answer),
  });
  expect(await client.changedBetween(ref, "x", "y")).toEqual(["a", "b"]);
  answer.status = "diverged";
  expect(await client.changedBetween(ref, "x", "y")).toBeNull();
});

it("reads a GitHub pull request URL as a ref on github.com", () => {
  expect(parseGithubPullUrl("https://github.com/o/r/pull/12/files")).toEqual({
    owner: "o",
    name: "r",
    number: 12,
    server: "https://github.com",
  });
  expect(() =>
    parseGithubPullUrl("https://github.com/o/r/issues/12"),
  ).toThrow();
});

it("searches PRs you're part of and answers them as the board's issues, on github.com", async () => {
  let asked = "";
  const client = github({
    "GET /search/issues": (_, url) => {
      asked = url.searchParams.get("q")!;
      return json({
        total_count: 51,
        items: [
          {
            id: 70,
            number: 7,
            title: "t",
            body: null,
            state: "closed",
            html_url: "https://github.com/o/r/pull/7",
            updated_at: "",
            user: { id: 2, login: "them" },
            labels: [],
            comments: 0,
            repository_url: "https://api.github.com/repos/o/r",
            pull_request: { merged_at: "2026-10-01T00:00:00Z" },
          },
        ],
      });
    },
  });
  const found = await client.search("review_requested", "", "closed", 1);
  expect(asked).toBe("is:pr archived:false review-requested:@me is:closed");
  expect(found.nextPage).toBe(2);
  expect(found.items[0]).toMatchObject({
    body: "",
    repository: {
      owner: "o",
      name: "r",
      full_name: "o/r",
      server: "https://github.com",
    },
    pull_request: { merged: true },
  });
});

it("searches beyond your own PRs only when the search names where", () => {
  expect(searchQuery("all", "flaky", "open")).toBe(
    "is:pr archived:false involves:@me is:open flaky",
  );
  expect(searchQuery("all", "repo:o/r flaky", "all")).toBe(
    "is:pr archived:false repo:o/r flaky",
  );
});
