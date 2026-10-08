import { afterEach, beforeEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddingJob } from "../../shared/projects";
import { Store } from "../app/store";
import { Projects } from "../projects/projects";
import type { TerminalSessions } from "../terminal-sessions";
import { cloneRepository } from "./clone";
import { ProjectAdding } from "./index";

let dir: string;
const saved = { ...process.env };
const jobs: (AddingJob | null)[] = [];

async function adding(onJob?: (job: AddingJob | null) => void) {
  const store = new Store(join(dir, "state"));
  await store.load();
  const projects = new Projects(store);
  const service = new ProjectAdding({
    store,
    projects,
    client: () => null,
    sessions: { recentFolders: async () => [] } as unknown as TerminalSessions,
    appData: join(dir, "app-data"),
    send: (job) => {
      jobs.push(job);
      onJob?.(job);
    },
  });
  return { store, projects, service };
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "relay-add-")));
  // Git reads only this config, whoever runs the tests.
  const config = join(dir, "gitconfig");
  await writeFile(
    config,
    "[user]\n\tname = Sample\n\temail = sample@example.com\n",
  );
  process.env.GIT_CONFIG_GLOBAL = config;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  jobs.length = 0;
});
afterEach(async () => {
  process.env = { ...saved };
  await rm(dir, { recursive: true, force: true });
});

const spec = (location: string) => ({
  name: "acme-web",
  location,
  git: true,
  github: false,
  private: true,
});

it("makes a new project with a first commit, remembers where, and reports the job's end", async () => {
  const { service, store } = await adding();
  const project = await service.create(spec(join(dir, "work")));
  expect(project.path).toBe(join(dir, "work", "acme-web"));
  expect(project.plain).toBeUndefined();
  const log = execFileSync("git", ["-C", project.path, "log", "--format=%s"], {
    encoding: "utf8",
  });
  expect(log.trim()).toBe("Start acme-web");
  expect(store.get().projectsFolder).toBe(join(dir, "work"));
  expect(jobs.at(-1)).toBeNull();
});

it("refuses a new project whose folder is there, and leaves the folder be", async () => {
  const { service } = await adding();
  const there = join(dir, "work", "acme-web");
  await mkdir(there, { recursive: true });
  await writeFile(join(there, "notes.txt"), "mine");
  await expect(service.create(spec(join(dir, "work")))).rejects.toThrow(
    /there already/,
  );
  expect(await readdir(there)).toEqual(["notes.txt"]);
});

it("asks for a Git identity before making anything", async () => {
  await writeFile(process.env.GIT_CONFIG_GLOBAL!, "");
  const { service } = await adding();
  await expect(service.create(spec(join(dir, "work")))).rejects.toThrow(
    /who you are/,
  );
  await expect(readdir(join(dir, "work", "acme-web"))).rejects.toThrow();
});

it("won't clone over a folder that isn't a clone of the repository", async () => {
  const { service } = await adding();
  const there = join(dir, "work", "web");
  await mkdir(there, { recursive: true });
  await writeFile(join(there, "keep.txt"), "mine");
  await expect(service.clone("acme/web", join(dir, "work"))).rejects.toThrow(
    /isn't a clone/,
  );
  expect(await readFile(join(there, "keep.txt"), "utf8")).toBe("mine");
});

it("adds a clone that's there already instead of cloning again", async () => {
  const { service } = await adding();
  const there = join(dir, "work", "web");
  execFileSync("git", ["init", "-q", there]);
  execFileSync("git", [
    "-C",
    there,
    "remote",
    "add",
    "origin",
    "git@github.com:Acme/web.git",
  ]);
  const project = await service.clone(
    "https://github.com/acme/web",
    join(dir, "work"),
  );
  expect(project.path).toBe(there);
  expect(jobs).toEqual([]);
});

it("clones with progress, and a stopped clone says so", async () => {
  const source = join(dir, "source");
  execFileSync("git", ["init", "-q", source]);
  await writeFile(join(source, "a.txt"), "a");
  execFileSync("git", ["-C", source, "add", "."]);
  execFileSync("git", ["-C", source, "commit", "-qm", "one"]);
  const steps: string[] = [];
  await cloneRepository(source, join(dir, "copy"), {
    extraArgs: [],
    onProgress: (step) => steps.push(step),
    signal: new AbortController().signal,
  });
  expect(await readFile(join(dir, "copy", "a.txt"), "utf8")).toBe("a");
  const stop = new AbortController();
  stop.abort();
  await expect(
    cloneRepository(source, join(dir, "again"), {
      extraArgs: [],
      onProgress: () => {},
      signal: stop.signal,
    }),
  ).rejects.toThrow("Cancelled.");
});

it("cancels creation before committing and never registers the project", async () => {
  const { service, projects } = await adding((job) => {
    if (job?.step === "First commit") service.cancel();
  });
  const location = join(dir, "work");
  await expect(service.create(spec(location))).rejects.toThrow(/Cancelled/);
  expect(await projects.list(null)).toEqual([]);
  expect(await readdir(location)).toEqual([]);
  expect(jobs.at(-1)).toBeNull();
});

it("cleans up a failed initial commit so creation can be retried", async () => {
  const { service } = await adding();
  const template = join(dir, "template");
  await mkdir(join(template, "hooks"), { recursive: true });
  const hook = join(template, "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  process.env.GIT_TEMPLATE_DIR = template;
  const location = join(dir, "work");
  await expect(service.create(spec(location))).rejects.toThrow();
  expect(await readdir(location)).toEqual([]);
  await rm(hook);
  expect((await service.create(spec(location))).path).toBe(
    join(location, "acme-web"),
  );
});

it("refuses an existing clone from a different owner with the same name", async () => {
  const { service } = await adding();
  const there = join(dir, "work", "web");
  execFileSync("git", ["init", "-q", there]);
  execFileSync("git", [
    "-C",
    there,
    "remote",
    "add",
    "origin",
    "https://github.com/alice/web.git",
  ]);
  await expect(service.clone("bob/web", join(dir, "work"))).rejects.toThrow(
    /isn't a clone of bob\/web/,
  );
  expect(
    execFileSync("git", ["-C", there, "remote", "get-url", "origin"], {
      encoding: "utf8",
    }).trim(),
  ).toBe("https://github.com/alice/web.git");
});
