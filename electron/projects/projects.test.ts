import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../app/store";
import { Projects } from "./projects";
import { Gitea } from "../pull-requests/gitea";
import { fixtureServer } from "../../tests/fixtures/gitea";
import { projectTitle } from "../../shared/projects";

it("titles a folder name by its words, leaving one with none as it is", () => {
  expect(projectTitle("relay-releases")).toBe("Relay Releases");
  expect(projectTitle("my__app  v2")).toBe("My App V2");
  expect(projectTitle("iOS-sdkTools")).toBe("IOS SdkTools");
  expect(projectTitle("--")).toBe("--");
});

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

it("links a github.com remote without any account, preferring origin over an older fork", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  const root = join(dir, "repo");
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  try {
    execFileSync("git", ["init", "-q", root]);
    // `old` sorts before `origin`, the way Git lists them.
    git("remote", "add", "old", "https://github.com/me/relay.git");
    git("remote", "add", "origin", "git@github.com:team/relay.git");
    const store = new Store(join(dir, "state"));
    await store.load();
    const projects = new Projects(store);
    const added = await projects.add(root, null);
    expect(added.repository).toEqual({
      server: "https://github.com",
      owner: "team",
      name: "relay",
    });
    // A project saved before GitHub links on its next listing.
    await store.update((s) => {
      s.projects![0]!.repository = null;
    });
    const [listed] = await new Projects(store).list(null);
    expect(listed!.repository?.owner).toBe("team");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("resolves legacy automatic names without rewriting saved names", async () => {
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
        project("c", "/code/web-store", "Web Store"),
      ];
    });
    const projects = new Projects(store);
    expect((await projects.list(null)).map((p) => p.name)).toEqual([
      "Relay Releases",
      "iOS app",
      "Web Store",
    ]);
    expect(store.get().projects![0].name).toBe("relay-releases");
    await store.update((s) => {
      s.smartProjectNames = false;
    });
    expect((await projects.list(null)).map((p) => p.name)).toEqual([
      "relay-releases",
      "iOS app",
      "web-store",
    ]);
    expect(store.get().projects![2].name).toBe("Web Store");
    // After the old migration, a raw folder name was an explicit rename.
    await store.update((s) => {
      s.projectTitlesTidied = true;
      s.smartProjectNames = true;
    });
    expect(projects.get("a").name).toBe("relay-releases");
    await projects.rename("a", "relay-releases");
    await store.update((s) => {
      s.smartProjectNames = true;
    });
    expect((await projects.list(null))[0]!.name).toBe("relay-releases");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("toggles existing and new project names, persists the setting, and preserves explicit names", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  try {
    const root = join(dir, "my-project_name.v2");
    await mkdir(root);
    const stateDir = join(dir, "state");
    const store = new Store(stateDir);
    await store.load();
    const projects = new Projects(store);
    const first = await projects.add(root, null);
    expect(first.name).toBe("My Project Name.v2");
    expect(store.get().projects![0].name).toBe("my-project_name.v2");
    await store.update((s) => {
      s.smartProjectNames = false;
    });
    expect(projects.get(first.id).name).toBe("my-project_name.v2");
    expect((await projects.add(root, null)).name).toBe("my-project_name.v2");
    const secondRoot = join(dir, "another-project");
    await mkdir(secondRoot);
    const second = await projects.add(secondRoot, null);
    expect(second.name).toBe("another-project");

    const reloaded = new Store(stateDir);
    await reloaded.load();
    expect(reloaded.get().smartProjectNames).toBe(false);
    const restored = new Projects(reloaded);
    expect((await restored.list(null)).map((p) => p.name)).toEqual([
      "my-project_name.v2",
      "another-project",
    ]);
    // Even a typed name identical to a default is deliberate.
    await restored.rename(first.id, "my-project_name.v2");
    await reloaded.update((s) => {
      s.smartProjectNames = true;
    });
    expect(restored.get(first.id).name).toBe("my-project_name.v2");
    expect(restored.get(second.id).name).toBe("Another Project");
    const scratch = await restored.scratch(
      join(dir, "Scratchpad"),
      () => false,
    );
    await reloaded.update((s) => {
      s.smartProjectNames = false;
    });
    expect(restored.get(scratch.id).name).toBe("Scratchpad");
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

it("reuses the Scratchpad folder no thread has used before making another", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  try {
    const store = new Store(join(dir, "state"));
    await store.load();
    const projects = new Projects(store);
    const used = new Set<string>();
    const scratchpad = join(dir, "Scratchpad");

    const first = await projects.scratch(scratchpad, (id) => used.has(id));
    expect(first).toMatchObject({ scratch: true, plain: true });
    expect(first.path.startsWith(scratchpad)).toBe(true);
    expect(await projects.scratch(scratchpad, (id) => used.has(id))).toEqual(
      first,
    );

    used.add(first.id);
    const second = await projects.scratch(scratchpad, (id) => used.has(id));
    expect(second.id).not.toBe(first.id);
    expect(second.path).not.toBe(first.path);
    expect(projects.scratchIds()).toEqual([first.id, second.id]);
    // Its folder is where the agent works, so it exists before the first message.
    expect(await projects.inspect(second.id)).toEqual({
      root: second.path,
      plain: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("still names the folder of a project deleted outside Relay, so its processes can be stopped", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  try {
    const store = new Store(join(dir, "state"));
    await store.load();
    const projects = new Projects(store);
    const root = join(dir, "licensing--search");
    await mkdir(root);
    const project = await projects.add(root, null);
    await rm(root, { recursive: true });
    await expect(projects.root(project.id)).rejects.toThrow("ENOENT");
    expect(await projects.taskFolder(project.id)).toBe(root);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("an exact add refuses a path that resolves elsewhere than it was checked", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  try {
    const store = new Store(join(dir, "state"));
    await store.load();
    const projects = new Projects(store);
    await mkdir(join(dir, "home"));
    await symlink(join(dir, "home"), join(dir, "x"));
    await expect(
      projects.add(join(dir, "x"), null, { exact: true }),
    ).rejects.toThrow(`${join(dir, "x")} now leads to ${join(dir, "home")}`);
    expect(store.get().projects ?? []).toEqual([]);
    // The user's + still follows the link.
    expect((await projects.add(join(dir, "x"), null)).path).toBe(
      join(dir, "home"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("hides a removed project and brings it back, same id, when its folder is added again", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "relay-project-")));
  try {
    const root = join(dir, "app");
    await mkdir(root);
    await writeFile(join(root, "keep.txt"), "x");
    const store = new Store(join(dir, "state"));
    await store.load();
    const projects = new Projects(store);
    const project = await projects.add(root, null);
    await projects.remove(project.id);
    expect(await projects.list(null)).toEqual([]);
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("x");
    // Its threads still find the folder while it is hidden.
    expect(projects.get(project.id).path).toBe(root);
    const back = await projects.add(root, null);
    expect(back.id).toBe(project.id);
    expect((await projects.list(null)).map((p) => p.id)).toEqual([project.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
