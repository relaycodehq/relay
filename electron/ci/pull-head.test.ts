import { expect, it } from "vitest";
import { GithubCredentials } from "../github/credentials";
import type { Gitea } from "../pull-requests/gitea";
import { Ci, type CiHosts } from "./index";

const head = "f".repeat(40);
const remote = { host: "github.com", owner: "base", name: "app" };
const noHosts: CiHosts = { gitea: null, azure: async () => null };

const failedCheck = {
  __typename: "CheckRun",
  name: "unit",
  status: "COMPLETED",
  conclusion: "FAILURE",
  detailsUrl: "https://github.com/base/app/runs/1",
  startedAt: "2026-10-09T22:00:00Z",
  completedAt: "2026-10-09T22:05:00Z",
  checkSuite: null,
};

it("reads a fork PR's CI off its head commit, not the base repository's branch of the same name", async () => {
  const asked: { query: string; variables: Record<string, unknown> }[] = [];
  const ci = new Ci(
    async (_url, init) => {
      const body = JSON.parse(init.body as string);
      asked.push(body);
      return Response.json({
        data: {
          repository: {
            object: {
              oid: head,
              messageHeadline: "Fix the thing",
              author: { name: "Forker" },
              statusCheckRollup: { contexts: { nodes: [failedCheck] } },
            },
          },
        },
      });
    },
    new GithubCredentials(async () => "token"),
  );

  const status = await ci.pullHeadStatus(
    remote,
    { branch: "main", sha: head },
    noHosts,
  );
  expect(asked).toHaveLength(1);
  expect(asked[0]!.query).toContain("object(oid: $oid)");
  expect(asked[0]!.variables).toMatchObject({
    owner: "base",
    name: "app",
    oid: head,
  });
  expect(status).toMatchObject({
    branch: "main",
    commit: { sha: head, message: "Fix the thing" },
    runs: [{ workflow: "unit", state: "failure" }],
  });
});

it("reads the head commit's runs and statuses without a gh login", async () => {
  const paths: string[] = [];
  const ci = new Ci(
    async (url) => {
      const { pathname, search } = new URL(url);
      paths.push(pathname + search);
      if (pathname.endsWith("/actions/runs"))
        return Response.json({
          workflow_runs: [
            {
              id: 1,
              name: "Checks",
              head_sha: head,
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/base/app/actions/runs/1",
              workflow_id: 10,
              created_at: "2026-09-24T10:00:00Z",
              updated_at: "2026-09-24T10:05:00Z",
            },
          ],
        });
      if (pathname.endsWith(`/commits/${head}/status`))
        return Response.json({ sha: head, statuses: [] });
      return new Response("{}", { status: 404 });
    },
    new GithubCredentials(async () => null),
  );

  const status = await ci.pullHeadStatus(
    remote,
    { branch: "main", sha: head },
    noHosts,
  );
  expect(paths).toContain(
    `/repos/base/app/actions/runs?head_sha=${head}&per_page=30&exclude_pull_requests=true`,
  );
  expect(paths.some((p) => p.includes("branch=") || p.includes("heads/"))).toBe(
    false,
  );
  expect(status?.commit.sha).toBe(head);
  expect(status?.runs[0]).toMatchObject({
    workflow: "Checks",
    state: "failure",
  });
});

it("still reads by branch for phones that send no head commit", async () => {
  const refs: unknown[] = [];
  const ci = new Ci(
    async (_url, init) => {
      refs.push(JSON.parse(init.body as string).variables.ref);
      return Response.json({ data: { repository: { ref: null } } });
    },
    new GithubCredentials(async () => "token"),
  );

  expect(
    await ci.pullHeadStatus(remote, { branch: "feature" }, noHosts),
  ).toBeNull();
  expect(refs).toEqual(["refs/heads/feature"]);
});

it("reads a Gitea fork PR's statuses off its head commit", async () => {
  const paths: string[] = [];
  const gitea = {
    account: { server: "https://git.example.com" },
    repo: (r: { owner: string; name: string }) => `/repos/${r.owner}/${r.name}`,
    request: async (path: string) => {
      paths.push(path);
      if (path.includes("/status?"))
        return {
          headers: new Headers({ "X-Total-Count": "1" }),
          data: {
            statuses: [
              {
                context: "Checks / unit (pull_request)",
                state: "failure",
                target_url: "u/unit",
                updated_at: "2026-09-24T10:00:00Z",
              },
            ],
          },
        };
      return {
        headers: new Headers(),
        data: { commit: { message: "Fix\n\nBody", author: { name: "Ada" } } },
      };
    },
  } as unknown as Gitea;

  const status = await new Ci(async () => {
    throw new Error("GitHub isn't asked");
  }).pullHeadStatus(
    { host: "git.example.com", owner: "base", name: "app" },
    { branch: "main", sha: head },
    { gitea, azure: async () => null },
  );
  expect(paths).toEqual([
    `/repos/base/app/commits/${head}/status?limit=50&page=1`,
    `/repos/base/app/git/commits/${head}`,
  ]);
  expect(status).toMatchObject({
    source: "Gitea",
    commit: { sha: head, message: "Fix", author: "Ada" },
    runs: [{ workflow: "Checks", state: "failure" }],
  });
});
