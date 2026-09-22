import { beforeEach, afterEach, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Gitea } from "../../electron/gitea";
import {
  PullRequestCreation,
  branchPulls,
} from "../../electron/pull-request-create";
import type { CreatePullRequest } from "../../shared/pull-request-create";
let root: string,
  remote: string,
  parent: string,
  client: Gitea,
  service: PullRequestCreation;
let pulls: any[], posts: number, failPost: boolean;
const repo = { owner: "team", name: "project" };
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const remoteGit = (...args: string[]) =>
  execFileSync("git", ["--git-dir", remote, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
function head(branch: string) {
  try {
    return remoteGit("rev-parse", "--verify", `refs/heads/${branch}`);
  } catch {
    return null;
  }
}
beforeEach(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), "relay-create-pr-")));
  root = join(parent, "repo");
  remote = join(parent, "remote.git");
  await mkdir(root);
  execFileSync("git", ["init", "--bare", "-q", remote]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  await writeFile(join(root, "file.ts"), "base\n");
  git("add", ".");
  git("commit", "-qm", "Base");
  git("remote", "add", "origin", pathToFileURL(remote).href);
  git("push", "-q", "origin", "main");
  git("switch", "-c", "feature");
  await writeFile(join(root, "file.ts"), "feature\n");
  git("commit", "-qam", "Make review useful");
  pulls = [];
  posts = 0;
  failPost = false;
  service = new PullRequestCreation();
  client = new Gitea(
    {
      id: "test-account",
      server: "https://gitea.invalid",
      user: { id: 1, login: "test" },
      persistent: false,
    },
    "test-token",
    async (url, options) => {
      const path = new URL(url).pathname.replace(
        "/api/v1/repos/team/project",
        "",
      );
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: {
            "content-type": "application/json",
            "x-total-count": Array.isArray(body) ? String(body.length) : "1",
          },
        });
      if (!path)
        return json({
          default_branch: "main",
          clone_url: pathToFileURL(remote).href,
          ssh_url: "",
        });
      if (path === "/branches")
        return json(
          remoteGit("for-each-ref", "--format=%(refname:short)", "refs/heads")
            .split("\n")
            .map((name) => ({ name })),
        );
      if (path.startsWith("/branches/")) {
        const id = head(decodeURIComponent(path.slice(10)));
        return id ? json({ commit: { id } }) : json({}, 404);
      }
      if (path === "/pulls" && options.method === "POST") {
        posts++;
        const body = JSON.parse(String(options.body));
        const p = {
          number: 8,
          title: body.title,
          body: body.body,
          draft: body.title.startsWith("WIP:"),
          html_url: "https://gitea.invalid/team/project/pulls/8",
          head: {
            ref: body.head,
            sha: head(body.head),
            repo: { full_name: "team/project" },
          },
          base: { ref: body.base },
        };
        pulls.push(p);
        if (failPost) return json({}, 500);
        return json(p, 201);
      }
      if (path === "/pulls") return json(pulls);
      return json({}, 404);
    },
  );
});
afterEach(async () => {
  client.dispose();
  await rm(parent, { recursive: true, force: true });
});
const input = (planId: string): CreatePullRequest => ({
  planId,
  base: "main",
  title: "Useful review",
  body: "Checked it",
  draft: false,
  push: true,
});
it("previews without pushing; explicitly pushes only committed content and creates a draft", async () => {
  await writeFile(join(root, "file.ts"), "uncommitted\n");
  const p = await service.prepare(root, client, repo);
  expect(p).toMatchObject({
    branch: "feature",
    base: "main",
    needsPush: true,
    dirtyFiles: 1,
    remote: "origin",
  });
  expect(p.commits).toHaveLength(1);
  expect(head("feature")).toBeNull();
  const created = await service.create(root, client, {
    ...input(p.id),
    draft: true,
  });
  expect(created.pull.ref.number).toBe(8);
  expect(pulls[0].title).toBe("WIP: Useful review");
  expect(head("feature")).toBe(p.head);
  expect(remoteGit("show", "feature:file.ts")).toBe("feature");
  expect(await readFile(join(root, "file.ts"), "utf8")).toBe("uncommitted\n");
  await service.create(root, client, input(p.id));
  expect(posts).toBe(1);
});
it("rejects stale checkouts and changed push destinations before any publication", async () => {
  const p = await service.prepare(root, client, repo);
  git("switch", "main");
  await expect(service.create(root, client, input(p.id))).rejects.toThrow(
    /branch changed/,
  );
  expect(posts).toBe(0);
  expect(head("feature")).toBeNull();
  git("switch", "feature");
  git(
    "remote",
    "set-url",
    "--push",
    "origin",
    "https://elsewhere.invalid/repo.git",
  );
  await expect(service.create(root, client, input(p.id))).rejects.toThrow(
    /destination changed/,
  );
  expect(posts).toBe(0);
});
it("requires explicit push consent and ignores another fork's same-named branch", async () => {
  pulls.push({
    number: 99,
    title: "Fork PR",
    head: { ref: "feature", repo: { full_name: "other/project" } },
    base: { ref: "main" },
  });
  expect(await branchPulls(root, client, repo)).toEqual([]);
  const p = await service.prepare(root, client, repo);
  await expect(
    service.create(root, client, { ...input(p.id), push: false }),
  ).rejects.toThrow(/needs pushing/);
  expect(head("feature")).toBeNull();
  expect(posts).toBe(0);
});
it("recovers an uncertain create result without pushing or creating twice", async () => {
  const p = await service.prepare(root, client, repo);
  failPost = true;
  await expect(service.create(root, client, input(p.id))).rejects.toThrow(
    /branch was pushed/,
  );
  failPost = false;
  expect(
    (await service.create(root, client, input(p.id))).pull.ref.number,
  ).toBe(8);
  expect(posts).toBe(1);
});
it("creates from an already published branch without pushing", async () => {
  git("push", "-q", "origin", "feature");
  const p = await service.prepare(root, client, repo);
  expect(p.needsPush).toBe(false);
  expect(
    (await service.create(root, client, { ...input(p.id), push: false })).pull
      .ref.number,
  ).toBe(8);
  expect((await branchPulls(root, client, repo))[0].ref.number).toBe(8);
});
