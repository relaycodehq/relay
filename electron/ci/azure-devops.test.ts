import { describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AzureDevOps } from "../pull-requests/azure-devops/client";
import { azureBuildState, latestAzureBuilds } from "./azure-devops";
import { Ci, remoteRepo } from "./index";
import { gitIn } from "../../tests/fixtures/git-repo";

type AzBuild = Parameters<typeof latestAzureBuilds>[0][number];

const build = (over: Partial<AzBuild>): AzBuild => ({
  definition: { id: 1, name: "CI" },
  status: "completed",
  result: "succeeded",
  sourceVersion: "ABC123",
  queueTime: "2026-10-01T10:00:00Z",
  startTime: "2026-10-01T10:01:00Z",
  finishTime: "2026-10-01T10:05:00Z",
  _links: {
    web: {
      href: "https://dev.azure.com/sample-org/p/_build/results?buildId=1",
    },
  },
  ...over,
});

describe("latestAzureBuilds", () => {
  it("reads the newest commit's latest build per pipeline", () => {
    const reading = latestAzureBuilds([
      build({
        definition: { id: 1, name: "CI" },
        status: "inProgress",
        result: undefined,
        finishTime: undefined,
        triggerInfo: { "ci.message": "Add search\n\nLonger body" },
        requestedFor: { displayName: "Ann Example" },
      }),
      build({
        definition: { id: 2, name: "Release" },
        result: "partiallySucceeded",
      }),
      // An earlier run of CI on the same commit: superseded.
      build({ definition: { id: 1, name: "CI" }, result: "failed" }),
      build({ definition: { id: 3, name: "Nightly" }, sourceVersion: "OLDER" }),
      build({ definition: { id: 4, name: "Lint" }, result: "canceled" }),
    ])!;
    expect(reading.commit).toEqual({
      sha: "abc123",
      message: "Add search",
      author: "Ann Example",
    });
    expect(reading.runs.map((r) => [r.workflow, r.state])).toEqual([
      ["CI", "running"],
      ["Release", "success"],
      ["Lint", "skipped"],
    ]);
    expect(reading.runs[0]).toMatchObject({
      url: "https://dev.azure.com/sample-org/p/_build/results?buildId=1",
      at: Date.parse("2026-10-01T10:01:00Z"),
    });
    expect(reading.runs[1].at).toBe(Date.parse("2026-10-01T10:05:00Z"));
  });

  it("has nothing to say without builds", () => {
    expect(latestAzureBuilds([])).toBeNull();
  });
});

it("reads a build's status and result as a CI state", () => {
  for (const status of ["notStarted", "inProgress", "cancelling", "postponed"])
    expect(azureBuildState({ status }), status).toBe("running");
  const finished = (result?: string) =>
    azureBuildState({ status: "completed", result });
  expect(finished("succeeded")).toBe("success");
  expect(finished("partiallySucceeded")).toBe("success");
  expect(finished("failed")).toBe("failure");
  expect(finished("canceled")).toBe("skipped");
  expect(finished("none")).toBe("skipped");
  expect(finished(undefined)).toBe("skipped");
});

async function clone(remote: string, branch: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-ci-azure-")));
  const git = (...args: string[]) => gitIn(root, ...args);
  git("init", "-q", "-b", branch);
  git("remote", "add", "origin", remote);
  return { root, done: () => rm(root, { recursive: true, force: true }) };
}

it("reads an Azure DevOps origin as its organization, project and repository", async () => {
  const { root, done } = await clone(
    "git@ssh.dev.azure.com:v3/Sample-Org/Sample%20Project/web-store",
    "main",
  );
  try {
    expect(await remoteRepo(root)).toEqual({
      host: "dev.azure.com",
      server: "https://dev.azure.com/sample-org",
      owner: "Sample Project",
      name: "web-store",
    });
  } finally {
    await done();
  }
});

describe("Azure Pipelines in Ci.status", () => {
  const ci = new Ci(async () => {
    throw new Error("GitHub isn't asked for an Azure remote");
  });

  it("reads the organization's builds, falling back to the default branch", async () => {
    const { root, done } = await clone(
      "https://dev.azure.com/sample-org/Sample%20Project/_git/status-repo",
      "feature/search",
    );
    const asked: URL[] = [];
    const client = {
      request: async (url: string) => {
        const u = new URL(url);
        asked.push(u);
        if (u.pathname.endsWith("/_apis/git/repositories/status-repo"))
          return {
            data: { id: "repo-guid", defaultBranch: "refs/heads/main" },
          };
        const branch = u.searchParams.get("branchName");
        return {
          data: {
            value:
              branch === "refs/heads/main"
                ? [build({ definition: { id: 1, name: "CI" } })]
                : [],
          },
        };
      },
    } as unknown as AzureDevOps;
    const servers: string[] = [];
    try {
      const status = await ci.status(root, {
        gitea: null,
        azure: async (server) => {
          servers.push(server);
          return client;
        },
      });
      expect(status).toMatchObject({
        source: "Azure Pipelines",
        branch: "main",
        commit: { sha: "abc123" },
        runs: [expect.objectContaining({ workflow: "CI", state: "success" })],
        // CI ran on a commit this clone doesn't have.
        ahead: 0,
      });
      expect(new Set(servers)).toEqual(
        new Set(["https://dev.azure.com/sample-org"]),
      );
      const builds = asked.filter((u) =>
        u.pathname.endsWith("/_apis/build/builds"),
      );
      expect(builds.map((u) => u.pathname)).toEqual([
        "/sample-org/Sample%20Project/_apis/build/builds",
        "/sample-org/Sample%20Project/_apis/build/builds",
      ]);
      expect(builds.map((u) => u.searchParams.get("branchName"))).toEqual([
        "refs/heads/feature/search",
        "refs/heads/main",
      ]);
      expect(builds[0].searchParams.get("repositoryId")).toBe("repo-guid");
    } finally {
      await done();
    }
  });

  it("asks for an az login when the organization has no client, and stays quiet when turned off", async () => {
    const { root, done } = await clone(
      "https://dev.azure.com/sample-org/Sample%20Project/_git/quiet-repo",
      "main",
    );
    try {
      await expect(
        ci.status(root, { gitea: null, azure: async () => null }),
      ).rejects.toThrow(/az login/);
      expect(
        await ci.status(
          root,
          {
            gitea: null,
            azure: async () => {
              throw new Error("not asked");
            },
          },
          (kind) => kind !== "azure-devops",
        ),
      ).toBeNull();
    } finally {
      await done();
    }
  });
});
