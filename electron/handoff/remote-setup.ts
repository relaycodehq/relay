// A paired computer's clone of a project this one has, before a thread of
// it can go over: the URL it clones from, and the clone there.
import {
  parseRemote,
  type AddingJob,
  type Project,
} from "../../shared/projects";
import type { CloneProgress, ComputerProject } from "../../shared/remote";
import { git } from "../git/git";
import { fromHome } from "./setup-agent";

/**
 * What another computer clones the repository at `root` from: origin, else
 * its first remote, when it's a URL the add-project palette clones. GitHub
 * goes over HTTPS, which a `gh` login there signs in to where SSH keys may
 * be missing.
 */
export async function cloneUrl(root: string): Promise<string | undefined> {
  const remotes = (await git(root, ["remote"]).catch(() => ""))
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  if (!remote) return undefined;
  // As configured: this computer's `insteadOf` rewrites are its own.
  const url = (
    await git(root, ["config", "--get", `remote.${remote}.url`]).catch(() => "")
  ).trim();
  const parsed = parseRemote(url);
  if (!parsed) return undefined;
  return parsed.host === "github.com"
    ? `https://github.com/${parsed.full}.git`
    : parsed.url;
}

export interface CloneHost {
  defaultFolder(): Promise<string>;
  clone(
    url: string,
    into: string,
    onStep: (job: AddingJob) => void,
  ): Promise<Project>;
  /** The project's repositories as `computerProjects` lists them. */
  repositories(project: Project): Promise<string[]>;
}

interface Clone {
  job: Promise<ComputerProject>;
  step: string;
  progress: number | null;
}

/** How long a `cloneProject` call waits for the clone before it says how far it is. */
const answerMs = 1500;

/**
 * Clones by URL, one job per URL however often it's asked about; the caller
 * polls until one answer says done or throws the clone's error.
 */
export class CloneRequests {
  private clones = new Map<string, Clone>();
  constructor(private host: CloneHost) {}

  async ask(url: string, from: string): Promise<CloneProgress> {
    let clone = this.clones.get(url);
    if (!clone) {
      const started: Clone = (clone = {
        step: "Starting",
        progress: null,
        job: this.start(url, (job) => {
          started.step = job.step;
          started.progress = job.progress;
        }),
      });
      this.clones.set(url, started);
      const begun = Date.now();
      started.job.then(
        (p) =>
          console.info(
            `Cloned ${p.name} for ${from} in ${((Date.now() - begun) / 1000).toFixed(1)}s.`,
          ),
        (e: unknown) =>
          console.warn(
            `A clone for ${from} failed:`,
            e instanceof Error ? e.message : e,
          ),
      );
    }
    const current = clone;
    const project = await Promise.race([
      current.job,
      new Promise<null>((r) => setTimeout(() => r(null), answerMs)),
    ]).catch((e: unknown) => {
      this.clones.delete(url);
      throw e;
    });
    if (!project)
      return { done: false, step: current.step, progress: current.progress };
    this.clones.delete(url);
    return { done: true, project };
  }

  private async start(url: string, onStep: (job: AddingJob) => void) {
    const project = await this.host.clone(
      url,
      await this.host.defaultFolder(),
      onStep,
    );
    return {
      id: project.id,
      name: project.name,
      repositories: await this.host.repositories(project).catch(() => []),
      folder: fromHome(project.path),
    };
  }
}
