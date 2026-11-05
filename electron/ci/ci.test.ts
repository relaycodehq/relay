import { GithubCredentials } from "../github/credentials";
import { it, expect } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciSummary, type CiRun } from "../../shared/ci";
import { GitHub } from "./github";
import {
  latestGithubRuns,
  githubRunState,
  type GithubRun,
  type RollupContext,
} from "./github-runs";
import { statusRuns } from "./statuses";
import { remoteRepo } from "./index";
import { gitIn } from "../../tests/fixtures/git-repo";
import { gitRuns } from "../../tests/fixtures/git-runs";

const run = (workflow: string, state: CiRun["state"], at: number): CiRun => ({
  workflow,
  state,
  url: `https://ci.example/${workflow}`,
  at,
});

it("keeps a failure red after a later pass and opens the failed run", () => {
  const s = ciSummary([
    run("Checks", "failure", 1),
    run("Release", "success", 2),
  ]);
  expect(s).toMatchObject({ state: "failure", target: { workflow: "Checks" } });
  expect(
    ciSummary([run("Checks", "success", 1), run("Release", "running", 2)]),
  ).toMatchObject({ state: "running", target: { workflow: "Release" } });
  expect(
    ciSummary([run("Checks", "success", 1), run("Release", "success", 2)])
      ?.target.workflow,
  ).toBe("Release");
  // Cancelled or skipped runs decide nothing.
  expect(ciSummary([run("Checks", "skipped", 1)])).toBeNull();
});

const gh = (over: Partial<GithubRun>): GithubRun => ({
  id: 1,
  name: "Checks",
  head_sha: "new",
  status: "completed",
  conclusion: "success",
  html_url: "https://github.com/o/r/actions/runs/1",
  workflow_id: 10,
  created_at: "2026-09-24T10:00:00Z",
  updated_at: "2026-09-24T10:05:00Z",
  ...over,
});

it("reads the newest commit's latest run per workflow from GitHub", () => {
  const latest = latestGithubRuns([
    gh({ id: 3, workflow_id: 10, status: "in_progress", conclusion: null }),
    gh({ id: 2, workflow_id: 20, name: "Release", conclusion: "failure" }),
    gh({ id: 1, workflow_id: 10 }),
    gh({ id: 0, workflow_id: 30, head_sha: "old" }),
  ])!;
  expect(latest.runs.map((r) => r.id)).toEqual([3, 2]);
  expect(latest.runs.map(githubRunState)).toEqual(["running", "failure"]);
  expect(githubRunState(gh({ conclusion: "cancelled" }))).toBe("skipped");
  expect(latestGithubRuns([])).toBeNull();
});

it("shows commit statuses from CI outside Actions next to Actions runs", async () => {
  const at = "2026-09-24T10:10:00Z";
  const release = {
    context: "Release",
    state: "pending",
    target_url: "https://mini.example/log",
    updated_at: at,
  };
  // Without a gh login, so the REST reading of the tip.
  const answer = (routes: Record<string, unknown>) =>
    new GitHub(
      async (url) => {
        const path = new URL(url).pathname;
        const body = routes[path];
        return body === undefined
          ? new Response("{}", { status: 404 })
          : Response.json(body);
      },
      new GithubCredentials(async () => null),
    );
  const actions = "/repos/o/r/actions/runs";
  const tip = "/repos/o/r/commits/heads/feature/x/status";

  // A push the build machine picked up before any Actions run: its tip wins.
  const onlyStatuses = await answer({
    [actions]: { workflow_runs: [gh({ head_sha: "old" })] },
    [tip]: { sha: "tip", statuses: [release] },
    "/repos/o/r/commits/tip": {
      commit: { message: "Ship it\n\nBody", author: { name: "Ada" } },
    },
  }).read({ owner: "o", name: "r" }, "feature/x");
  expect(onlyStatuses).toMatchObject({
    commit: { sha: "tip", message: "Ship it", author: "Ada" },
    runs: [{ workflow: "Release", state: "running" }],
  });

  // Both on the same commit.
  const both = await answer({
    [actions]: { workflow_runs: [gh({ head_sha: "tip" })] },
    [tip]: { sha: "tip", statuses: [{ ...release, state: "failure" }] },
  }).read({ owner: "o", name: "r" }, "feature/x");
  expect(both?.runs.map((r) => [r.workflow, r.state])).toEqual([
    ["Checks", "success"],
    ["Release", "failure"],
  ]);

  // No statuses, or none readable: Actions alone, as before.
  const actionsOnly = await answer({
    [actions]: { workflow_runs: [gh({ head_sha: "old" })] },
  }).read({ owner: "o", name: "r" }, "feature/x");
  expect(actionsOnly?.commit.sha).toBe("old");
  expect(actionsOnly?.runs.map((r) => r.workflow)).toEqual(["Checks"]);
});

it("reads every page of the tip's statuses, so an early failure still counts", async () => {
  /** 150 contexts, newest first; the oldest failed. */
  const statuses = Array.from({ length: 150 }, (_, i) => ({
    context: `job${150 - i}`,
    state: i === 149 ? "failure" : "success",
    target_url: `https://ci.example/${150 - i}`,
    updated_at: "2026-11-05T10:00:00Z",
  }));
  const asked: string[] = [];
  const github = new GitHub(
    async (url) => {
      const { pathname, searchParams } = new URL(url);
      asked.push(pathname);
      if (pathname.endsWith("/actions/runs"))
        return Response.json({ workflow_runs: [] });
      if (!pathname.endsWith("/status"))
        return Response.json({ commit: { message: "m" } });
      // GitHub's combined status: 30 a page unless asked, 100 at most.
      const size = Math.min(Number(searchParams.get("per_page")) || 30, 100);
      const page = Number(searchParams.get("page")) || 1;
      return Response.json({
        sha: "tip",
        statuses: statuses.slice((page - 1) * size, page * size),
      });
    },
    new GithubCredentials(async () => null),
  );

  const reading = await github.read({ owner: "o", name: "r" }, "main");

  expect(reading?.runs).toHaveLength(150);
  expect(reading?.runs).toContainEqual(
    expect.objectContaining({ workflow: "job1", state: "failure" }),
  );
  // The second page is asked by the sha, in case the branch moved meanwhile.
  expect(asked.filter((p) => p.endsWith("/status"))).toEqual([
    "/repos/o/r/commits/heads/main/status",
    "/repos/o/r/commits/tip/status",
  ]);
});

it("walks back past commits CI never saw to the last one it reported on", async () => {
  const commit = (oid: string, contexts?: RollupContext[]) => ({
    oid,
    messageHeadline: `Commit ${oid}`,
    author: { name: "Ada" },
    statusCheckRollup: contexts ? { contexts: { nodes: contexts } } : null,
  });
  const pages = [
    { nodes: [commit("c3"), commit("c2")], next: "cursor" },
    {
      nodes: [
        commit("c1", [
          {
            __typename: "StatusContext",
            context: "Release",
            state: "SUCCESS",
            targetUrl: "https://github.com/o/r/releases/tag/v1",
            createdAt: "2026-10-09T22:12:55Z",
          },
          {
            __typename: "CheckRun",
            name: "unit",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: "https://github.com/o/r/runs/1",
            startedAt: "2026-10-09T22:00:00Z",
            completedAt: "2026-10-09T22:05:00Z",
            checkSuite: {
              workflowRun: {
                url: "https://github.com/o/r/actions/runs/9",
                workflow: { name: "Checks" },
              },
            },
          },
          {
            __typename: "CheckRun",
            name: "e2e",
            status: "COMPLETED",
            conclusion: "FAILURE",
            detailsUrl: "https://github.com/o/r/runs/2",
            startedAt: "2026-10-09T22:00:00Z",
            completedAt: "2026-10-09T22:06:00Z",
            checkSuite: {
              workflowRun: {
                url: "https://github.com/o/r/actions/runs/9",
                workflow: { name: "Checks" },
              },
            },
          },
        ]),
        commit("c0", [
          {
            __typename: "StatusContext",
            context: "Release",
            state: "FAILURE",
            targetUrl: null,
            createdAt: "2026-10-08T00:00:00Z",
          },
        ]),
      ],
    },
  ];
  const asked: unknown[] = [];
  const github = new GitHub(
    async (_url, init) => {
      const { variables } = JSON.parse(init.body as string);
      asked.push(variables.after);
      const page = pages[variables.after ? 1 : 0]!;
      return Response.json({
        data: {
          repository: {
            ref: {
              target: {
                history: {
                  pageInfo: {
                    hasNextPage: !!page.next,
                    endCursor: page.next ?? null,
                  },
                  nodes: page.nodes,
                },
              },
            },
          },
        },
      });
    },
    new GithubCredentials(async () => "token"),
  );
  const reading = await github.read({ owner: "o", name: "r" }, "main");
  expect(asked).toEqual([null, "cursor"]);
  expect(reading?.commit).toEqual({
    sha: "c1",
    message: "Commit c1",
    author: "Ada",
  });
  // Actions jobs group under their workflow; the release status stands alone.
  expect(reading?.runs).toEqual([
    {
      workflow: "Release",
      state: "success",
      url: "https://github.com/o/r/releases/tag/v1",
      at: Date.parse("2026-10-09T22:12:55Z"),
    },
    {
      workflow: "Checks",
      state: "failure",
      failedJob: "e2e",
      url: "https://github.com/o/r/actions/runs/9",
      at: Date.parse("2026-10-09T22:06:00Z"),
    },
  ]);
});

it("reads every page of a commit's checks, so a failure past the first 100 still shows", async () => {
  const check = (name: string, conclusion: string): RollupContext => ({
    __typename: "CheckRun",
    name,
    status: "COMPLETED",
    conclusion,
    detailsUrl: `https://github.com/o/r/runs/${name}`,
    startedAt: "2026-10-09T22:00:00Z",
    completedAt: "2026-10-09T22:05:00Z",
    checkSuite: null,
  });
  const passes = Array.from({ length: 100 }, (_, i) =>
    check(`ok${i}`, "SUCCESS"),
  );
  const commit = (contexts: RollupContext[], next: string | null) => ({
    oid: "c1",
    messageHeadline: "Commit c1",
    author: { name: "Ada" },
    statusCheckRollup: {
      contexts: {
        pageInfo: { hasNextPage: !!next, endCursor: next },
        nodes: contexts,
      },
    },
  });
  const asked: { oid?: string; after: string | null }[] = [];
  const github = new GitHub(
    async (_url, init) => {
      const { query, variables } = JSON.parse(init.body as string);
      if (query.includes("history(")) {
        asked.push({ after: variables.after });
        return Response.json({
          data: {
            repository: {
              ref: {
                target: {
                  history: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [commit(passes, "p2")],
                  },
                },
              },
            },
          },
        });
      }
      asked.push({ oid: variables.oid, after: variables.after });
      const object =
        variables.after === "p2"
          ? commit(passes, "p3")
          : commit([check("e2e", "FAILURE")], null);
      return Response.json({ data: { repository: { object } } });
    },
    new GithubCredentials(async () => "token"),
  );

  const reading = await github.read({ owner: "o", name: "r" }, "main");
  expect(asked).toEqual([
    { after: null },
    { oid: "c1", after: "p2" },
    { oid: "c1", after: "p3" },
  ]);
  // Page two repeats page one's names, which group into the same runs.
  expect(reading?.runs).toHaveLength(101);
  expect(ciSummary(reading!.runs)?.state).toBe("failure");

  // A rollup that never ends stops at ten pages.
  let pages = 0;
  const endless = new GitHub(
    async (_url, init) => {
      const { query } = JSON.parse(init.body as string);
      const next = commit(passes, `p${++pages + 1}`);
      return Response.json({
        data: {
          repository: query.includes("history(")
            ? {
                ref: {
                  target: {
                    history: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [next],
                    },
                  },
                },
              }
            : { object: next },
        },
      });
    },
    new GithubCredentials(async () => "token"),
  );
  await endless.read({ owner: "o", name: "r" }, "main");
  expect(pages).toBe(10);
});

it("groups Gitea Actions job statuses under their workflow", () => {
  const at = "2026-09-24T10:00:00Z";
  const runs = statusRuns([
    {
      context: "Checks / lint (push)",
      state: "success",
      target_url: "u/lint",
      updated_at: at,
    },
    {
      context: "Checks / typecheck (push)",
      state: "failure",
      target_url: "u/tc",
      updated_at: at,
    },
    {
      context: "Release / publish (push)",
      state: "pending",
      target_url: "u/rel",
      updated_at: at,
    },
    {
      context: "ci/drone",
      state: "success",
      target_url: "u/drone",
      updated_at: at,
    },
  ]);
  expect(runs).toEqual([
    expect.objectContaining({
      workflow: "Checks",
      state: "failure",
      failedJob: "typecheck",
      url: "u/tc",
    }),
    expect.objectContaining({ workflow: "Release", state: "running" }),
    expect.objectContaining({ workflow: "ci/drone", state: "success" }),
  ]);
});

it("reads host and repository off origin, scp-style and under a subpath", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-ci-")));
  const git = (...args: string[]) => gitIn(root, ...args);
  try {
    git("init", "-q");
    git("remote", "add", "upstream", "https://github.com/else/where.git");
    expect(await remoteRepo(root)).toEqual({
      host: "github.com",
      owner: "else",
      name: "where",
    });
    git("remote", "add", "origin", "git@github.com:relaycodehq/relay.git");
    expect(await remoteRepo(root)).toEqual({
      host: "github.com",
      owner: "relaycodehq",
      name: "relay",
    });
    git(
      "remote",
      "set-url",
      "origin",
      "https://git.example.com/gitea/team/app.git",
    );
    expect(await remoteRepo(root)).toEqual({
      host: "git.example.com",
      owner: "team",
      name: "app",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// CI polls every 90s; the remote it reads off only changes with the config.
it.skipIf(process.platform === "win32")(
  "reads the remote again only once the config changed",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "relay-ci-")));
    const git = (...args: string[]) => gitIn(root, ...args);
    try {
      git("init", "-q");
      git("remote", "add", "origin", "https://github.com/else/where.git");
      await remoteRepo(root);
      expect(await gitRuns(() => remoteRepo(root))).toEqual([]);
      git("remote", "set-url", "origin", "https://github.com/team/app.git");
      expect(await remoteRepo(root)).toMatchObject({ owner: "team" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
