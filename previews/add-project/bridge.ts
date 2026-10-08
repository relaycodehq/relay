// The add-project calls on sample folders. Clones and creates run a short
// simulated job; nothing touches the disk or GitHub.
import type { Api } from "../../shared/types";
import {
  linkName,
  parseRemote,
  projectTitle,
  repoName,
  type AddingJob,
  type Project,
} from "../../shared/projects";
import {
  agentFolders,
  disk,
  githubLogin,
  githubRepos,
  home,
  projects,
  repos,
  workFolder,
} from "./add-project-data";

const expand = (path: string) =>
  (path.startsWith("~") ? home + path.slice(1) : path).replace(/(.)\/+$/, "$1");
const parent = (path: string) => path.slice(0, path.lastIndexOf("/"));

const listeners = new Set<(job: AddingJob | null) => void>();
const send = (job: AddingJob | null) => listeners.forEach((l) => l(job));
let stop: (() => void) | undefined;

function add(path: string): Project {
  const there = projects.find((p) => p.path === path);
  if (there) return there;
  const project: Project = {
    id: linkName(path),
    name: projectTitle(linkName(path)),
    path,
    repository: null,
    added: Date.now(),
  };
  projects.push(project);
  repos.add(path);
  disk[parent(path)] = [...new Set([...(disk[parent(path)] ?? []), linkName(path)])].sort();
  return project;
}

/** Steps through `steps` over ~2s, then adds `path`. */
function job(title: string, steps: string[], path: string) {
  return new Promise<Project>((resolve, reject) => {
    let tick = 0;
    const ticks = 24;
    send({ title, step: steps[0], progress: 0 });
    const timer = setInterval(() => {
      if (++tick > ticks) {
        clearInterval(timer);
        send(null);
        return resolve(add(path));
      }
      const at = tick / ticks;
      send({ title, step: steps[Math.min(steps.length - 1, Math.floor(at * steps.length))], progress: at });
    }, 80);
    stop = () => {
      clearInterval(timer);
      send(null);
      reject(new Error("Cancelled."));
    };
  });
}

export const addingBridge: Partial<Api> = {
  projects: async () => projects,
  addingStart: async () => ({ cloneFolder: workFolder, home, recent: agentFolders }),
  githubRepos: async () => {
    await new Promise((r) => setTimeout(r, 300));
    return { login: githubLogin, repos: githubRepos };
  },
  onProjectAdding: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  listFolders: async (dir) =>
    (disk[expand(dir)] ?? []).map((name) => {
      const path = `${expand(dir)}/${name}`;
      return { name, path, repository: repos.has(path) };
    }),
  inspectFolder: async (typed) => {
    const path = expand(typed);
    if (repos.has(path)) return { path, kind: "repository" };
    const root = [...repos].find((r) => path.startsWith(`${r}/`));
    if (root) return { path, kind: "inside", root };
    return { path, kind: disk[parent(path)]?.includes(linkName(path)) ? "plain" : "missing" };
  },
  addProjectAt: async (typed, setUpGit) =>
    setUpGit ? job(`Setting up git in ${linkName(typed)}`, ["git init"], expand(typed)) : add(expand(typed)),
  cloneProject: async (remote, into) => {
    const parsed = parseRemote(remote)!;
    return job(
      `Cloning ${parsed.full}`,
      ["Counting objects", "Receiving objects", "Resolving deltas", "Updating files"],
      `${expand(into)}/${repoName(parsed.full)}`,
    );
  },
  createProject: async (spec) => {
    const steps = ["Creating the folder"];
    if (spec.git) steps.push("git init", "First commit");
    if (spec.github) steps.push(`Creating ${githubLogin}/${spec.name} on GitHub`);
    return job(`Creating ${spec.name}`, steps, `${expand(spec.location)}/${spec.name}`);
  },
  cancelProjectAdding: async () => stop?.(),
  linkSuggestions: async (id) => {
    const project = projects.find((p) => p.id === id)!;
    return (disk[parent(project.path)] ?? []).map((name) => {
      const path = `${parent(project.path)}/${name}`;
      return {
        path,
        project: projects.find((p) => p.path === path)?.name,
        repository: repos.has(path),
        beside: true,
      };
    });
  },
  saveProjectSettings: async (id, settings) => {
    const project = projects.find((p) => p.id === id)!;
    project.settings = settings;
    return project;
  },
  chooseFolder: async () => `${home}/PhpstormProjects`,
};
