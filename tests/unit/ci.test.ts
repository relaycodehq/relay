import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ciSummary, type CiRun } from "../../shared/ci";
import {
  GitHub,
  latestGithubRuns,
  githubRunState,
  type GithubRun,
} from "../../electron/ci/github";
import { statusRuns } from "../../electron/ci/statuses";
import { remoteRepo } from "../../electron/ci";

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
  const answer = (routes: Record<string, unknown>) =>
    new GitHub(async (url) => {
      const path = new URL(url).pathname;
      const body = routes[path];
      return body === undefined
        ? new Response("{}", { status: 404 })
        : Response.json(body);
    });
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
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("remote", "add", "upstream", "https://github.com/else/where.git");
    expect(await remoteRepo(root)).toEqual({
      host: "github.com",
      owner: "else",
      name: "where",
    });
    git("remote", "add", "origin", "git@github.com:lubomirmolin/relay.git");
    expect(await remoteRepo(root)).toEqual({
      host: "github.com",
      owner: "lubomirmolin",
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
