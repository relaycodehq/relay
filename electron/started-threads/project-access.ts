import { basename, resolve } from "node:path";
import type { Project } from "../../shared/projects";
import { toolText, type RelayToolArgs } from "../relay-mcp";
import { folderVerdict, realFolder, type FolderRules } from "./project-folder";
import { json } from "./tool-output";

/** The user's projects as the tools see and add them. */
export interface AgentProjects {
  list(): Promise<Project[]>;
  /** Adds the real folder the user approved, as the user's + does; refuses it once it resolves elsewhere. */
  add(folder: string): Promise<Project>;
  /** The root of the Git repository `dir` is in; null when it's in none. */
  repositoryRoot(dir: string): Promise<string | null>;
  /** Where home, Relay's data and the system's folders are, for the refusals. */
  rules(): Promise<Omit<FolderRules, "projects">>;
}

/** Project discovery and guarded folder registration for agent tools. */
export class ProjectAccess {
  constructor(private projects?: AgentProjects) {}

  private reach() {
    if (!this.projects)
      throw new Error("Relay's projects can't be reached from here.");
    return this.projects;
  }

  all() {
    return this.reach().list();
  }

  /** The user's projects an agent may start threads in: all but Scratchpad's. */
  async real() {
    return (await this.reach().list()).filter((p) => !p.scratch);
  }

  async list(projectId: string) {
    return (await this.real()).map((p) => ({
      id: p.id,
      name: p.name,
      folder: p.path,
      git: !p.plain,
      ...(p.id === projectId ? { current: true } : {}),
    }));
  }

  async add(
    { folder }: RelayToolArgs<"add_project">,
    approve: (title: string, detail: string) => Promise<boolean>,
  ) {
    const projects = this.reach();
    const rules = await projects.rules();
    const found = await realFolder(folder, rules.platform);
    if ("refused" in found) return toolText(found.refused, true);
    const { real } = found;
    const listed = await projects.list();
    const verdict = folderVerdict(real, { ...rules, projects: listed });
    if (verdict.kind === "refused") return toolText(verdict.reason, true);
    if (verdict.kind === "existing") {
      const p = listed.find((p) => p.id === verdict.id)!;
      return json({
        id: p.id,
        name: p.name,
        folder: p.path,
        git: !p.plain,
        alreadyAdded: true,
      });
    }
    const repository = await projects.repositoryRoot(real);
    if (repository && repository !== real) {
      const outer = folderVerdict(repository, { ...rules, projects: listed });
      return toolText(
        outer.kind === "ok"
          ? `That's inside the Git repository at ${repository}; add that folder instead.`
          : `That's inside the Git repository at ${repository}, which can't be added: ${outer.kind === "refused" ? outer.reason : "it's a project already."}`,
        true,
      );
    }
    const linked = resolve(folder) !== real;
    const approved = await approve(
      `Add “${basename(real)}” to Relay as a project?`,
      [
        real,
        `${repository ? "Git repository." : "Plain folder, no Git."} Agents in its threads can read and change everything in this folder.`,
        ...(linked
          ? [`(Asked for ${JSON.stringify(folder)}, a link to this folder.)`]
          : []),
      ].join("\n"),
    );
    if (!approved)
      return toolText(
        "The user didn't add this folder. Ask them what they want instead.",
        true,
      );
    // The card can wait for minutes; meanwhile the agent may swap the folder
    // for a link to home, or the user may add it or a folder around it.
    const now = await realFolder(real, rules.platform);
    if (!("real" in now) || now.real !== real)
      return toolText(
        `${real} changed while the user was asked; nothing was added.`,
        true,
      );
    const recheck = folderVerdict(real, {
      ...rules,
      projects: await projects.list(),
    });
    if (recheck.kind === "refused") return toolText(recheck.reason, true);
    const project = await projects.add(real);
    return json({
      id: project.id,
      name: project.name,
      folder: project.path,
      git: !project.plain,
    });
  }
}
