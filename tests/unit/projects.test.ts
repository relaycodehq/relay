import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../electron/store";
import { Projects } from "../../electron/projects";
import { Gitea } from "../../electron/gitea";
import { fixtureServer } from "../fixtures/gitea";

it("links through a remote Gitea knows when another remote is gone", async () => {
  const fixture = await fixtureServer();
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  const root = join(dir, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  try {
    execFileSync("git", ["init", "-q", root]);
    // Git lists remotes alphabetically, so the deleted one is tried first.
    git("remote", "add", "archive", `${fixture.serverUrl}/Gone/old.git`);
    git("remote", "add", "origin", `${fixture.serverUrl}/Web/web-store.git`);
    const store = new Store(join(dir, "state"));
    await store.load();
    const client = new Gitea(
      {
        id: "fixture",
        server: fixture.serverUrl,
        user: { id: 1, login: "reviewer" },
        persistent: true,
      },
      "test-token",
      fetch,
    );
    const project = await new Projects(store).add(root, client);
    expect(project.repository).toEqual({
      server: fixture.serverUrl,
      owner: "Web",
      name: "web-store",
    });
  } finally {
    await fixture.close();
    await rm(dir, { recursive: true, force: true });
  }
});
