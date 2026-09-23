import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { Store } from "./store";
import type { Gitea } from "./gitea";
import type { Project } from "../shared/projects";
import {
  moveProjectInList,
  parentGroup,
  rebaseGroup,
} from "../shared/project-folders";
import { git, gitBytes } from "./git";
import { digest } from "./hash";
import { inspectRepository, remoteUrl } from "./repository";
import { readWorkingFile, decodeText, writeWorkingFile } from "./working-files";
export function repositoryFromRemote(
  raw: string,
  server: string,
): Project["repository"] {
  const remote = remoteUrl(raw);
  if (!remote || remote.hostname !== new URL(server).hostname) return null;
  const parts = remote.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  return { server, owner: parts.at(-2)!, name: parts.at(-1)! };
}
const unique = (values: string[]) => [...new Set(values)];
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
      s.projects!.find((p) => p.id === id)!.name = name;
    });
    return this.get(id);
  }
  groups() {
    return this.store.get().projectGroups ?? [];
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
            repository: { server: client.account.server, owner, name },
            added: Date.now(),
          });
      }
    if (additions.length)
      await this.store.update((s) => {
        s.projects = [...(s.projects ?? []), ...additions];
      });
    if (client)
      for (const p of this.store.get().projects ?? [])
        if (!p.repository) {
          const attempt = JSON.stringify([client.account.id, p.id]);
          if (!this.linkAttempts.has(attempt)) {
            this.linkAttempts.add(attempt);
            // Network discovery must not hold the local project list hostage.
            void this.link(p.id, client).catch(() => {});
          }
        }
    return this.store.get().projects ?? [];
  }
  get(id: string) {
    const project = this.store.get().projects?.find((p) => p.id === id);
    if (!project) throw new Error("Project not found. Add its folder first.");
    return project;
  }
  async root(id: string) {
    const p = this.get(id),
      root = await realpath(p.path);
    if (
      root !== p.path ||
      (await realpath(
        (await git(root, ["rev-parse", "--show-toplevel"])).trim(),
      )) !== root
    )
      throw new Error(
        "This project’s Git root changed. Add the correct folder again.",
      );
    return root;
  }
  async add(path: string, client: Gitea | null) {
    const root = await realpath(path);
    if (
      (await realpath(
        (await git(root, ["rev-parse", "--show-toplevel"])).trim(),
      )) !== root
    )
      throw new Error("Choose the root of a Git repository.");
    const existing = this.store.get().projects?.find((p) => p.path === root);
    if (existing) return existing;
    const project: Project = {
      id: randomUUID(),
      path: root,
      name: basename(root),
      repository: null,
      added: Date.now(),
    };
    await this.store.update((s) => {
      (s.projects ??= []).push(project);
    });
    if (client) {
      try {
        return await this.link(project.id, client);
      } catch {
        /* Local work must remain available when the Git host is offline. */
      }
    }
    return project;
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
      const response = await client.request<{ full_name: string }>(
        client.repo(repo),
      );
      if (
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
  async files(id: string) {
    const root = await this.root(id);
    const names = (
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
    if (names.length > 50000)
      throw new Error(
        "This checkout has more than 50,000 files. Narrow its Git checkout before browsing here.",
      );
    return [...new Set(names)].sort();
  }
  async file(id: string, path: string) {
    const root = await this.root(id),
      file = await readWorkingFile(root, path);
    if (!file) throw new Error("This file no longer exists.");
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
    id: string,
    path: string,
    head: string,
    version: string,
    contents: string,
  ) {
    const root = await this.root(id);
    await writeWorkingFile(root, path, version, { contents }, async () => {
      await this.root(id);
      if ((await git(root, ["rev-parse", "HEAD"])).trim() !== head)
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
