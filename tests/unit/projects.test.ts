import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
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

it("title-cases folder-named projects once and leaves typed names alone", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  try {
    const store = new Store(join(dir, "state"));
    await store.load();
    const project = (id: string, path: string, name: string) => ({
      id,
      path,
      name,
      repository: null,
      added: 0,
    });
    await store.update((s) => {
      s.projects = [
        project("a", "/code/relay-releases", "relay-releases"),
        project("b", "/code/app", "iOS app"),
      ];
    });
    const projects = new Projects(store);
    expect((await projects.list(null)).map((p) => p.name)).toEqual([
      "Relay Releases",
      "iOS app",
    ]);
    await projects.rename("a", "relay-releases");
    expect((await projects.list(null))[0]!.name).toBe("relay-releases");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("opens and saves files in a folder without Git", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  const root = join(dir, "workspace");
  try {
    await mkdir(join(root, "notes"), { recursive: true });
    await mkdir(join(root, "node_modules/lib"), { recursive: true });
    await writeFile(join(root, "README.md"), "# Workspace\n");
    await writeFile(join(root, "notes/todo.txt"), "ship it\n");
    await writeFile(join(root, "node_modules/lib/index.js"), "");
    // A repository inside lists its own files, its ignores applied.
    const app = join(root, "app");
    execFileSync("git", ["init", "-q", app]);
    await mkdir(join(app, "target"));
    await writeFile(join(app, ".gitignore"), "target/\n");
    await writeFile(join(app, "main.rs"), "fn main() {}\n");
    await writeFile(join(app, "target/build.o"), "");
    const store = new Store(join(dir, "state"));
    await store.load();
    const projects = new Projects(store);
    const project = await projects.add(root, null);
    expect(project.plain).toBe(true);
    expect((await projects.list(null))[0]!.plain).toBe(true);
    const place = await projects.inspect(project.id);
    expect(await projects.files(place)).toEqual([
      "README.md",
      "app/.gitignore",
      "app/main.rs",
      "notes/todo.txt",
    ]);
    const file = await projects.file(place, "notes/todo.txt");
    expect(file).toMatchObject({ head: "", original: "ship it\n" });
    await projects.save(place, "notes/todo.txt", "", file.version, "done\n");
    expect(await readFile(join(root, "notes/todo.txt"), "utf8")).toBe("done\n");
    // A folder inside a repository would run Git against that repository.
    await expect(projects.add(app + "/target", null)).rejects.toThrow(
      "Choose the root of its Git repository.",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
