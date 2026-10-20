// The add-project palette's work in the main process: what it opens on,
// adding a folder, cloning, and making a new project. One clone or creation
// runs at a time; its progress goes to the window as it goes.
import { lstat, mkdir, realpath, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  parseRemote,
  repoName,
  type AddingJob,
  type AddingStart,
  type NewProject,
  type Project,
} from "../../shared/projects";
import type { Store } from "../app/store";
import { git } from "../git/git";
import { isRemoteOf } from "../git/repository";
import { inspectFolder, expandHome } from "../projects/folder-inspect";
import type { Projects } from "../projects/projects";
import type { Gitea } from "../pull-requests/gitea";
import { cloneRepository } from "./clone";
import { createProjectFolder } from "./create";
import { githubCredentials } from "./github";

export { githubRepos } from "./github";

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );
const isRepository = (path: string) => exists(join(path, ".git"));

/** A project whose folder is on this computer: not a Scratchpad, nor one on another computer, whose path means nothing here. */
const here = (p: Project) => !p.scratch && !p.computer;

export class ProjectAdding {
  private running?: AbortController;

  constructor(
    private deps: {
      store: Store;
      projects: Projects;
      client: () => Gitea | null;
      send: (job: AddingJob | null) => void;
    },
  ) {}

  async start(): Promise<AddingStart> {
    return { cloneFolder: await this.defaultFolder(), home: homedir() };
  }

  /** Where a clone goes when nobody picks a folder: as the palette would open on it. */
  async defaultFolder() {
    const projects = await this.deps.projects.list(this.deps.client());
    return this.cloneFolder(projects.filter(here));
  }

  /** The folder the last clone or new project went into, else the newest project's parent. */
  private async cloneFolder(projects: Project[]) {
    const saved = this.deps.store.get().projectsFolder;
    if (
      saved &&
      (await stat(saved).then(
        (s) => s.isDirectory(),
        () => false,
      ))
    )
      return saved;
    const newest = [...projects].sort((a, b) => b.added - a.added)[0];
    return newest ? dirname(newest.path) : homedir();
  }

  async addAt(path: string, setUpGit = false) {
    const info = await inspectFolder(path);
    if (info.kind === "missing") throw new Error(`${info.path} isn't there.`);
    if (info.kind === "file")
      throw new Error(`${info.path} is a file, not a folder.`);
    if (info.kind === "inside")
      throw new Error(
        `That's inside the Git repository at ${info.root}; add that folder instead.`,
      );
    if (info.kind === "plain" && setUpGit) await git(info.path, ["init"]);
    return this.deps.projects.add(info.path, this.deps.client());
  }

  /** `onStep` hears its progress besides the window, for a clone a paired computer asked for. */
  async clone(
    remoteText: string,
    into: string,
    onStep?: (job: AddingJob) => void,
  ) {
    const remote = parseRemote(remoteText);
    if (!remote) throw new Error("That isn't a clone URL or owner/repo.");
    const parent = expandHome(into);
    const dest = join(parent, repoName(remote.full));
    if (await exists(dest)) {
      const [owner, name] = [dirname(remote.full), repoName(remote.full)];
      const origin = (await isRepository(dest))
        ? await git(dest, ["remote", "get-url", "origin"]).then(
            (v) => v.trim(),
            () => "",
          )
        : "";
      if (!origin || !isRemoteOf(origin, remote.host, { owner, name }))
        throw new Error(
          `${dest} is there already and isn't a clone of ${remote.full}.`,
        );
      await this.remember(parent);
      return this.deps.projects.add(dest, this.deps.client());
    }
    return this.job(`Cloning ${remote.full}`, onStep, async (signal, step) => {
      await mkdir(parent, { recursive: true });
      // Made here, so a folder that turned up since is refused, not removed below.
      await mkdir(dest);
      try {
        await cloneRepository(remote.url, dest, {
          extraArgs: await githubCredentials(remote.host),
          onProgress: step,
          signal,
        });
      } catch (e) {
        // Only what this clone made; the folder wasn't there before it.
        await rm(dest, { recursive: true, force: true });
        throw e;
      }
      await this.remember(parent);
      return this.deps.projects.add(dest, this.deps.client());
    });
  }

  async create(spec: NewProject) {
    const location = expandHome(spec.location);
    const dest = join(location, spec.name);
    if (await exists(dest)) {
      // Asked again after the answer got lost, as over a dropped link: it's made.
      const real = await realpath(dest);
      const made = (await this.deps.projects.list(this.deps.client())).find(
        (p) => here(p) && p.path === real,
      );
      if (made) return made;
      throw new Error(`${dest} is there already.`);
    }
    return this.job(
      `Creating ${spec.name}`,
      undefined,
      async (signal, step) => {
        await createProjectFolder({ ...spec, location }, dest, step, signal);
        if (signal.aborted) throw new Error("Cancelled.");
        await this.remember(location);
        return this.deps.projects.add(dest, this.deps.client());
      },
    );
  }

  cancel() {
    this.running?.abort();
  }

  private async job(
    title: string,
    onStep: ((job: AddingJob) => void) | undefined,
    work: (
      signal: AbortSignal,
      step: (step: string, progress: number | null) => void,
    ) => Promise<Project>,
  ) {
    if (this.running)
      throw new Error("Another clone is under way. Wait for it, or cancel it.");
    const running = (this.running = new AbortController());
    const send = (job: AddingJob) => {
      this.deps.send(job);
      onStep?.(job);
    };
    send({ title, step: "Starting", progress: null });
    try {
      const project = await work(running.signal, (step, progress) =>
        send({ title, step, progress }),
      );
      if (running.signal.aborted) throw new Error("Cancelled.");
      return project;
    } catch (error) {
      if (running.signal.aborted && (error as Error).name === "AbortError")
        throw new Error("Cancelled.");
      throw error;
    } finally {
      this.running = undefined;
      this.deps.send(null);
    }
  }

  private remember(folder: string) {
    return this.deps.store.update((s) => {
      s.projectsFolder = folder;
    });
  }
}
