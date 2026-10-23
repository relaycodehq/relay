// On the computer a thread is going to, when Relay's clone of its project
// failed there: an agent in a Scratchpad thread of its own gets it set up,
// and the computer the thread comes from follows that thread as it would a
// live handoff's. Signing in happens here, by the user, as the agent tells
// them; no credentials cross between the computers.
import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentProvider } from "../../shared/agents";
import type { ChatCameFrom, HandoffSettings } from "../../shared/handoff";
import {
  parseRemote,
  repoName,
  type ChatSummary,
  type Project,
  type ProjectChatSend,
} from "../../shared/projects";
import type { ComputerProject, SetupRequest } from "../../shared/remote";
import { repositoryNames } from "../git/bundles";
import { git } from "../git/git";
import { findExecutable } from "../platform/executables";
import { expandHome } from "../projects/folder-inspect";

export interface SetupHost {
  /** The thread a handoff, or a setup, from another computer made here. */
  handedOver(id: string): ChatSummary | undefined;
  /** Makes the setup's thread and sends its first message. */
  adoptSetup(
    projectId: string,
    title: string,
    cameFrom: Omit<ChatCameFrom, "carried" | "tip">,
    input: ProjectChatSend,
  ): Promise<unknown>;
  /** A Scratchpad project for it to work in. */
  scratch(): Promise<{ id: string }>;
  defaultFolder(): Promise<string>;
  addAt(path: string): Promise<Project>;
  /** This computer's projects, as `computerProjects` lists them. */
  projects(): Promise<ComputerProject[]>;
}

/** `/Users/you/code/relay` → `~/code/relay`. */
export const fromHome = (path: string) => {
  const home = homedir();
  return path === home || path.startsWith(home + "/") || path.startsWith(home + "\\")
    ? "~" + path.slice(home.length)
    : path;
};

const isRepository = (dir: string) =>
  lstat(join(dir, ".git")).then(
    () => true,
    () => false,
  );

export class SetupAgents {
  private starting = new Map<string, Promise<void>>();
  /** One look at a time, so threads asking together don't add the clone twice. */
  private looking: Promise<unknown> = Promise.resolve();
  constructor(private host: SetupHost) {}

  /** Starts the setup's thread here, once however often it's asked. */
  start(id: string, request: SetupRequest, from: { id: string; name: string }) {
    if (this.host.handedOver(id)) return Promise.resolve();
    let job = this.starting.get(id);
    if (!job) {
      job = this.begin(id, request, from).finally(() =>
        this.starting.delete(id),
      );
      this.starting.set(id, job);
    }
    return job;
  }

  private async begin(
    id: string,
    request: SetupRequest,
    from: { id: string; name: string },
  ) {
    const remote = parseRemote(request.url);
    if (!remote) throw new Error("That isn't a clone URL.");
    const [folder, tools, keys, scratch] = await Promise.all([
      this.host.defaultFolder(),
      installed(["git", "gh", "glab", "ssh"]),
      sshKeys(),
      this.host.scratch(),
    ]);
    const dest = join(expandHome(folder), repoName(remote.full));
    const agent = await setupAgent(request.settings);
    if (!agent)
      throw new Error(
        "No agent is installed on this computer to set the project up.",
      );
    const { provider, ...settings } = agent;
    await this.host.adoptSetup(
      scratch.id,
      `Set up ${remote.full} for ${from.name}`,
      { id, computer: from.name, deviceId: from.id, at: Date.now() },
      {
        ...settings,
        id: randomUUID(),
        body: setupPrompt({
          from: from.name,
          url: request.url,
          error: request.error,
          dest: fromHome(dest),
          tools,
          keys,
        }),
        to: provider,
        provider,
      },
    );
    console.info(`An agent sets up ${remote.full} here for ${from.name}.`);
  }

  /**
   * The project, once a project here has one of `repositories`. A clone of
   * one in `folder`, or in the folder clones go to, is added as a project
   * first; the agent leaves that to Relay.
   */
  progress(repositories: string[], folder?: string) {
    const look = () => this.look(repositories, folder);
    const next = this.looking.then(look, look);
    this.looking = next.catch(() => undefined);
    return next;
  }

  private async look(
    repositories: string[],
    folder?: string,
  ): Promise<{ done: false } | { done: true; project: ComputerProject }> {
    const wanted = new Set(repositories.map((r) => r.toLowerCase()));
    const has = (names: string[]) =>
      names.some((r) => wanted.has(r.toLowerCase()));
    const found = (await this.host.projects()).find((p) =>
      has(p.repositories),
    );
    if (found) return { done: true, project: found };
    const candidates = folder
      ? [expandHome(folder)]
      : await clonesIn(expandHome(await this.host.defaultFolder()), wanted);
    for (const path of candidates) {
      const names = await repositoryNames(path).catch((): string[] => []);
      if (!has(names) || !(await cloned(path))) continue;
      const project = await this.host.addAt(path);
      return {
        done: true,
        project: {
          id: project.id,
          name: project.name,
          repositories: names,
          folder: fromHome(project.path),
        },
      };
    }
    return { done: false };
  }
}

/** Agents Relay can tell are missing by their command; the others it takes on trust. */
const commands = new Set<AgentProvider>(["claude", "codex", "opencode"]);
const here = (provider: AgentProvider) =>
  !commands.has(provider)
    ? Promise.resolve(true)
    : findExecutable(provider).then(
        () => true,
        () => false,
      );

/**
 * The agent that sets it up: the thread's own when it's installed here,
 * else Claude or Codex on their default model. Never in plan mode or read
 * only, which would only plan the clone; read only asks instead.
 */
async function setupAgent(
  settings: HandoffSettings,
): Promise<HandoffSettings | undefined> {
  const runtimeMode =
    settings.runtimeMode === "read-only"
      ? "approval-required"
      : settings.runtimeMode;
  if (await here(settings.provider))
    return { ...settings, runtimeMode, interactionMode: "default" };
  for (const provider of ["claude", "codex"] as const)
    if (provider !== settings.provider && (await here(provider)))
      return {
        provider,
        choice: { model: "", fast: false, reasoningEffort: "" },
        runtimeMode,
        interactionMode: "default",
      };
}

/**
 * Whether the clone at `path` is through: a clone still fetching has no
 * commit at HEAD yet, and one still checking out holds the index lock.
 */
async function cloned(path: string) {
  const head = await git(path, ["rev-parse", "--verify", "-q", "HEAD"]).then(
    () => true,
    () => false,
  );
  if (!head) return false;
  const lock = await git(path, ["rev-parse", "--git-path", "index.lock"]);
  return !(await lstat(resolve(path, lock.trim())).catch(() => undefined));
}

/** Repositories in `dir` named like one of `wanted`'s, any case. */
async function clonesIn(dir: string, wanted: Set<string>) {
  const names = new Set([...wanted].map((r) => repoName(r).toLowerCase()));
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const e of entries)
    if (e.isDirectory() && names.has(e.name.toLowerCase())) {
      const path = join(dir, e.name);
      if (await isRepository(path)) found.push(path);
    }
  return found;
}

async function installed(names: string[]) {
  const found = await Promise.all(
    names.map((n) =>
      findExecutable(n).then(
        () => true,
        () => false,
      ),
    ),
  );
  return {
    on: names.filter((_, i) => found[i]),
    missing: names.filter((_, i) => !found[i]),
  };
}

async function sshKeys() {
  const files = await readdir(join(homedir(), ".ssh")).catch(
    (): string[] => [],
  );
  return files.filter((f) => f.endsWith(".pub"));
}

const platformName = () =>
  process.platform === "darwin"
    ? "macOS"
    : process.platform === "win32"
      ? "Windows"
      : "Linux";

/** What Relay asks the setup's agent; the user sees it folded, as "what Relay asked". */
export function setupPrompt(p: {
  from: string;
  url: string;
  error: string;
  dest: string;
  tools: { on: string[]; missing: string[] };
  keys: string[];
}) {
  const remote = parseRemote(p.url);
  const host = remote?.host ?? "the host";
  const full = remote?.full ?? "owner/name";
  const github = host === "github.com";
  const githubSignIn = ` For GitHub, \`gh auth login --hostname github.com --git-protocol https --web\` prints a one-time code and waits; send them the code and https://github.com/login/device, and wait for it.`;
  return `Relay is handing a thread from ${p.from} to this computer, but its project isn't here yet, and Relay's own clone of ${p.url} failed. Git said:

\`\`\`
${p.error.trim()}
\`\`\`

Get it cloned into exactly \`${p.dest}\`. Relay adds it as a project by itself once it's there, and the thread goes on in a session of its own; don't add it to Relay yourself, and don't start on the thread's work.

This computer: ${platformName()}. On PATH: ${p.tools.on.join(", ") || "none of git, gh, glab, ssh"}${p.tools.missing.length ? `; not found: ${p.tools.missing.join(", ")}` : ""}. SSH public keys in ~/.ssh: ${p.keys.join(", ") || "none"}.

First try what already works here: when an SSH key here is accepted (\`ssh -o BatchMode=yes -T git@${host}\`), clone over SSH (\`git@${host}:${full}.git\`). When nothing here gets through, don't decide how to sign in. Tell the user what's wrong and what's signed in here now, then ask: may you sign in to their account here, which makes it the one this computer uses (say so when that replaces or switches away from an account already signed in), or will they sort it out on this computer themselves? Do only what they allow, and nothing clever around accounts beyond it.

The user isn't at this computer. They read this conversation on ${p.from} and answer from there, so:
- Run nothing that waits for typed input. When signing in needs the user, start it in the background so it keeps waiting, then tell them exactly what to open and what to paste, the code or key in a code block of its own.${github ? githubSignIn : ""}
- Never ask them for a password, a token or a private key, and copy no credentials from anywhere: they sign in on this computer themselves.
- Change nothing here the clone doesn't need, and ask before installing anything.
- Once it's cloned, say so in one line and stop.`;
}
