import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import { ApiError, type Gitea } from "./gitea";
import {
  projectTitle,
  type Project,
  type ProjectSettings,
} from "../shared/projects";
import {
  moveGroupInList,
  moveProjectInList,
  parentGroup,
  rebaseGroup,
  sortGroupPaths,
} from "../shared/project-folders";
import { git, gitBytes } from "./git";
import { isGitMissing } from "../shared/working-tree";
import { folderFiles } from "./folder-files";
import { digest } from "./hash";
import {
  inspectRepository,
  remoteOnHost,
  remoteUrl,
  repoOf,
} from "./repository";
import { readWorkingFile, decodeText, writeWorkingFile } from "./working-files";
function repositoryFromRemote(
  raw: string,
  server: string,
): Project["repository"] {
  const remote = remoteUrl(raw);
  if (!remote || !remoteOnHost(remote, new URL(server).hostname)) return null;
  const repo = repoOf(remote);
  return repo && { server, ...repo };
}
const unique = (values: string[]) => [...new Set(values)];
/** The root of the repository `dir` is in; null when it's in none. */
async function repositoryRoot(dir: string) {
  try {
    return await realpath(
      (await git(dir, ["rev-parse", "--show-toplevel"])).trim(),
    );
  } catch (e) {
    // Without Git installed, every folder is a plain one.
    if (isGitMissing(e) || /not a git repository/i.test((e as Error).message))
      return null;
    throw e;
  }
}
/** Marks a folder without Git, so the app leaves out branches, changes and history. */
const withKind = async (p: Project): Promise<Project> =>
  (await lstat(join(p.path, ".git")).then(
    () => true,
    () => false,
  ))
    ? p
    : { ...p, plain: true };
const maxFiles = 50000;
/** A folder to browse: a project's checkout, or a thread's worktree of it. */
export interface Place {
  root: string;
  plain: boolean;
}
export class Projects {
  /** Moves a project into `folder`, before `before` (or last in that folder). */
  async move(id: string, folder: string, before: string | null) {
    this.get(id);
    if (before === id) return;
    await this.store.update((s) => {
      s.projects = moveProjectInList(s.projects!, id, folder, before);
      if (folder)
        s.projectGroups = unique([...(s.projectGroups ?? []), folder]);
    });
  }
  /** Renames a project in the sidebar; its folder on disk stays as it is. */
  async rename(id: string, name: string) {
    this.get(id);
    await this.store.update((s) => {
      const project = s.projects!.find((p) => p.id === id)!;
      project.name = name;
      project.automaticName = null;
    });
    return this.get(id);
  }
  /** Replaces what the project does its own way; an empty set follows the app again. */
  async saveSettings(id: string, settings: ProjectSettings) {
    this.get(id);
    await this.store.update((s) => {
      const project = s.projects!.find((p) => p.id === id)!;
      if (Object.keys(settings).length) project.settings = settings;
      else delete project.settings;
    });
    return withKind(this.get(id));
  }
  /** Group paths in sidebar order; alphabetical until one is dragged. */
  groups() {
    const s = this.store.get();
    const groups = s.projectGroups ?? [];
    return s.projectGroupsOrdered ? groups : sortGroupPaths(groups);
  }
  async moveGroup(path: string, before: string | null) {
    if (!path) throw new Error("Choose a group.");
    const groups = this.groups();
    await this.store.update((s) => {
      s.projectGroups = moveGroupInList(groups, path, before);
      s.projectGroupsOrdered = true;
    });
  }
  async createGroup(path: string) {
    if (!path) throw new Error("Name the group.");
    await this.store.update((s) => {
      s.projectGroups = unique([...(s.projectGroups ?? []), path]);
    });
  }
  /** Renames a group; its subgroups and projects move with it. */
  renameGroup(from: string, to: string) {
    if (!to) throw new Error("Name the group.");
    return this.rebaseGroup(from, to);
  }
  /** Removes a group; what was inside moves up one level. */
  removeGroup(path: string) {
    return this.rebaseGroup(path, parentGroup(path));
  }
  private async rebaseGroup(from: string, to: string) {
    if (!from) throw new Error("Choose a group.");
    await this.store.update((s) => {
      for (const project of s.projects ?? []) {
        if (!project.folder) continue;
        const folder = rebaseGroup(project.folder, from, to);
        if (folder) project.folder = folder;
        else delete project.folder;
      }
      s.projectGroups = unique(
        (s.projectGroups ?? [])
          .map((group) => rebaseGroup(group, from, to))
          .filter(Boolean),
      );
    });
  }
  private linkAttempts = new Set<string>();
  readonly changingBranch = new Set<string>();
  assertCheckoutAvailable(id: string) {
    if (this.changingBranch.has(id))
      throw new Error("Wait for the branch switch to finish.");
  }
  constructor(private store: Store) {}
  /** Resolve names at read time so toggling never rewrites saved or custom names. */
  private named(project: Project): Project {
    if (project.scratch || project.automaticName === null) return project;
    // Older saves only kept the formatted title. Recognize their default names
    // from the folder/repository, leaving all other names as typed.
    const original =
      project.automaticName ??
      [basename(project.path), project.repository?.name].find(
        (name) =>
          name &&
          (project.name === projectTitle(name) ||
            (!this.store.get().projectTitlesTidied && project.name === name)),
      );
    if (!original) return project;
    return {
      ...project,
      name:
        this.store.get().smartProjectNames === false
          ? original
          : projectTitle(original),
    };
  }
  async list(client: Gitea | null) {
    // Import existing links without deleting the saved review workspace or progress.
    const known = this.store.get().projects ?? [];
    const additions: Project[] = [];
    if (client)
      for (const [key, path] of Object.entries(this.store.get().folders)) {
        const [account, owner, name] = JSON.parse(key);
        if (
          account === client.account.id &&
          !known.some((p) => p.path === path) &&
          !additions.some((p) => p.path === path)
        )
          additions.push({
            id: randomUUID(),
            path,
            name,
            automaticName: name,
            repository: { server: client.account.server, owner, name },
            added: Date.now(),
          });
      }
    if (additions.length)
      await this.store.update((s) => {
        s.projects = [...(s.projects ?? []), ...additions];
      });
    const projects = await Promise.all(
      (this.store.get().projects ?? []).map((p) => withKind(this.named(p))),
    );
    if (client)
      for (const p of projects)
        if (!p.repository && !p.plain) {
          const attempt = JSON.stringify([client.account.id, p.id]);
          if (!this.linkAttempts.has(attempt)) {
            this.linkAttempts.add(attempt);
            // Network discovery must not hold the local project list hostage.
            void this.link(p.id, client).catch(() => {});
          }
        }
    return projects;
  }
  get(id: string) {
    const project = this.store.get().projects?.find((p) => p.id === id);
    if (!project) throw new Error("Project not found. Add its folder first.");
    return this.named(project);
  }
  /** The project's folder: its repository's root, or a plain folder outside any. */
  async inspect(id: string) {
    const p = this.get(id),
      root = await realpath(p.path),
      repository = root === p.path ? await repositoryRoot(root) : undefined;
    if (repository === undefined || (repository && repository !== root))
      throw new Error(
        "This project’s Git root changed. Add the correct folder again.",
      );
    return { root, plain: !repository };
  }
  async root(id: string) {
    return (await this.inspect(id)).root;
  }
  /** Where the project's processes run. A folder deleted outside Relay still names them, so they can be stopped. */
  async taskFolder(id: string) {
    const { path } = this.get(id);
    return realpath(path).catch(() => path);
  }
  async add(path: string, client: Gitea | null) {
    const root = await realpath(path),
      repository = await repositoryRoot(root);
    if (repository && repository !== root)
      throw new Error("Choose the root of its Git repository.");
    const existing = this.store.get().projects?.find((p) => p.path === root);
    if (existing) return withKind(this.named(existing));
    const project: Project = {
      id: randomUUID(),
      path: root,
      name: basename(root),
      automaticName: basename(root),
      repository: null,
      added: Date.now(),
    };
    await this.store.update((s) => {
      (s.projects ??= []).push(project);
    });
    if (client && repository) {
      try {
        return await this.link(project.id, client);
      } catch {
        /* Local work must remain available when the Git host is offline. */
      }
    }
    return withKind(this.named(project));
  }
  /**
   * A new Scratchpad chat's project. The one whose folder no thread has used
   * yet comes back, so opening and leaving chats doesn't pile up folders.
   */
  async scratch(dir: string, used: (id: string) => boolean) {
    const unused = this.store
      .get()
      .projects?.find((p) => p.scratch && !used(p.id));
    if (unused) {
      await mkdir(unused.path, { recursive: true });
      return withKind(unused);
    }
    const d = new Date();
    const day = [d.getMonth() + 1, d.getDate()]
      .map((n) => String(n).padStart(2, "0"))
      .join("-");
    const path = join(
      dir,
      `${d.getFullYear()}-${day}-${randomUUID().slice(0, 6)}`,
    );
    await mkdir(path, { recursive: true });
    const project: Project = {
      id: randomUUID(),
      path: await realpath(path),
      name: "Scratchpad",
      repository: null,
      added: Date.now(),
      scratch: true,
    };
    await this.store.update((s) => {
      (s.projects ??= []).push(project);
    });
    return withKind(project);
  }
  scratchIds() {
    return (this.store.get().projects ?? [])
      .filter((p) => p.scratch)
      .map((p) => p.id);
  }
  async link(id: string, client: Gitea) {
    const root = await this.root(id),
      remotes = await git(root, ["remote", "-v"]);
    for (const row of remotes.split("\n")) {
      const repo = repositoryFromRemote(
        row.split(/\s+/)[1] ?? "",
        client.account.server,
      );
      if (!repo) continue;
      const response = await client
        .request<{ full_name: string }>(client.repo(repo))
        .catch((e: unknown) => {
          // A deleted repository, or one this account can't see, isn't it.
          if (e instanceof ApiError && [403, 404].includes(e.status))
            return null;
          throw e;
        });
      if (
        !response ||
        response.data.full_name.toLowerCase() !==
          `${repo.owner}/${repo.name}`.toLowerCase()
      )
        continue;
      await this.store.update((s) => {
        s.projects!.find((p) => p.id === id)!.repository = repo;
        s.folders[JSON.stringify([client.account.id, repo.owner, repo.name])] =
          root;
      });
      return this.get(id);
    }
    throw new Error(
      "No Git remote matches your Gitea account. Add the repository’s remote in Git, then connect again.",
    );
  }
  async files({ root, plain }: Place) {
    const names = plain
      ? await folderFiles(root, maxFiles)
      : (
          await git(root, [
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
          ])
        )
          .split("\0")
          .filter(Boolean);
    if (names.length > maxFiles)
      throw new Error(
        plain
          ? "This folder has more than 50,000 files. Add a smaller folder to browse it here."
          : "This checkout has more than 50,000 files. Narrow its Git checkout before browsing here.",
      );
    return [...new Set(names)].sort();
  }
  async file({ root, plain }: Place, path: string) {
    const file = await readWorkingFile(root, path);
    if (!file) throw new Error("This file no longer exists.");
    // A plain folder has no committed version: the file is its own original.
    if (plain)
      return {
        path,
        contents: file.contents,
        version: file.hash,
        original: file.contents,
        head: "",
        branch: "",
      };
    // Only HEAD and the branch are needed, not a full status scan.
    const [head, branch] = (
      await Promise.all([
        git(root, ["rev-parse", "HEAD"]),
        git(root, ["branch", "--show-current"]),
      ])
    ).map((out) => out.trim());
    const entry = await git(root, ["ls-tree", "-z", head, "--", path]);
    const original = entry
      ? decodeText(await gitBytes(root, ["show", `${head}:${path}`]))
      : "";
    return {
      path,
      contents: file.contents,
      version: file.hash,
      original,
      head,
      branch,
    };
  }
  async save(
    { root, plain }: Place,
    path: string,
    head: string,
    version: string,
    contents: string,
  ) {
    await writeWorkingFile(root, path, version, { contents }, async () => {
      if (
        (plain ? "" : (await git(root, ["rev-parse", "HEAD"])).trim()) !== head
      )
        throw new Error(
          "The checkout moved to another commit. Reopen the file; your unsaved text is kept.",
        );
      if (!(await readWorkingFile(root, path)))
        throw new Error(
          "The file was deleted on disk. Reopen it before saving.",
        );
    });
    return { version: digest(contents) };
  }
  async linked(id: string, client: Gitea) {
    const p = this.get(id);
    if (!p.repository || p.repository.server !== client.account.server)
      throw new Error("Connect this project to your Gitea account first.");
    const local = await inspectRepository(
      await this.root(id),
      client.account.server,
      p.repository,
    );
    if (!local.remoteMatches)
      throw new Error("The clone no longer matches this Gitea repository.");
    return p.repository;
  }
}
