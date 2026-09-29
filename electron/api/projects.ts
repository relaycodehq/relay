import { app, dialog, nativeImage, shell } from "electron";
import { join } from "node:path";
import { z } from "zod";
import { agentProviderSchema } from "../../shared/agents";
import { chatIsEmpty } from "../../shared/chat-activity";
import { projectFolderSchema } from "../../shared/project-folders";
import { projectNameSchema } from "../../shared/projects";
import { createPullRequestSchema } from "../../shared/pull-request-create";
import { idSchema } from "../../shared/rooms";
import type { Pull } from "../../shared/types";
import { digestSchema, shaSchema, textSchema } from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import { agentRuntime } from "../agents";
import { projectIcon } from "../project-icon";
import { branchPulls } from "../pull-request-create";
import { pageSchema, type ApiContext, type Handlers } from "./context";

/** The project list and its folders, files, agents, and pull requests. */
export function projectHandlers(ctx: ApiContext) {
  const {
    projects,
    projectChats,
    ci,
    pullRequestCreation,
    requireClient,
    place,
  } = ctx;
  async function pullRequests(
    args: unknown[],
    method: "projectBranchPulls" | "projectPreparePull" | "projectCreatePull",
  ) {
    // A worktree thread's PR opens from its own branch.
    const { root, projectId, chatId } = await place(args[0]);
    const client = requireClient();
    const repo = await projects.linked(projectId, client);
    if (method === "projectBranchPulls") return branchPulls(root, client, repo);
    if (method === "projectPreparePull")
      return pullRequestCreation.prepare(root, client, repo);
    const created = await pullRequestCreation.create(
      root,
      client,
      createPullRequestSchema.parse(args[1]),
    );
    if (chatId)
      await projectChats.recordPull(chatId, {
        number: created.pull.ref.number,
        url: created.pull.url,
      });
    return created;
  }
  return {
    projectIcon: async (args) =>
      projectIcon(await projects.root(idSchema.parse(args[0])), (path) => {
        const image = nativeImage.createFromPath(path);
        return image.isEmpty()
          ? null
          : image.resize({ width: 128, quality: "best" }).toDataURL();
      }),
    projectGroups: () => projects.groups(),
    createProjectGroup: (args) =>
      projects.createGroup(projectFolderSchema.parse(args[0])),
    renameProjectGroup: (args) =>
      projects.renameGroup(
        projectFolderSchema.parse(args[0]),
        projectFolderSchema.parse(args[1]),
      ),
    removeProjectGroup: (args) =>
      projects.removeGroup(projectFolderSchema.parse(args[0])),
    moveProjectGroup: (args) =>
      projects.moveGroup(
        projectFolderSchema.parse(args[0]),
        projectFolderSchema.nullable().parse(args[1]),
      ),
    moveProject: (args) =>
      projects.move(
        idSchema.parse(args[0]),
        projectFolderSchema.parse(args[1]),
        idSchema.nullable().parse(args[2]),
      ),
    renameProject: (args) =>
      projects.rename(
        idSchema.parse(args[0]),
        projectNameSchema.parse(args[1]),
      ),
    revealProject: async (args) => {
      const error = await shell.openPath(
        await projects.root(idSchema.parse(args[0])),
      );
      if (error) throw new Error(error);
    },
    projects: () => projects.list(ctx.login.client),
    addProject: async () => {
      const result = await dialog.showOpenDialog(ctx.window.win!, {
        title: "Add a project folder",
        properties: ["openDirectory"],
      });
      return result.canceled
        ? null
        : projects.add(result.filePaths[0], ctx.login.client);
    },
    createScratch: () =>
      projects.scratch(join(app.getPath("userData"), "Scratchpad"), (id) =>
        projectChats.list(id).some((c) => !chatIsEmpty(c)),
      ),
    scratchChats: () =>
      projects
        .scratchIds()
        .flatMap((id) => projectChats.list(id))
        .sort((a, b) => b.updated - a.updated),
    linkProject: (args) =>
      projects.link(idSchema.parse(args[0]), requireClient()),
    projectCommands: async (args) => {
      const root = await projects.root(idSchema.parse(args[0]));
      return agentRuntime(agentProviderSchema.parse(args[1])).commands(root);
    },
    agentModels: (args) =>
      agentRuntime(agentProviderSchema.parse(args[0])).models(),
    agentDefaults: async (args) =>
      agentRuntime(agentProviderSchema.parse(args[1])).defaults(
        await projects.root(idSchema.parse(args[0])),
      ),
    projectFiles: async (args) => projects.files(await place(args[0])),
    projectFile: async (args) =>
      projects.file(await place(args[0]), workingPathSchema.parse(args[1])),
    saveProjectFile: async (args) =>
      projects.save(
        await place(args[0]),
        workingPathSchema.parse(args[1]),
        // A plain folder has no HEAD.
        shaSchema.or(z.literal("")).parse(args[2]),
        digestSchema.parse(args[3]),
        textSchema.parse(args[4]),
      ),
    projectCiStatus: async (args) => {
      const id = idSchema.parse(args[0]);
      const chatId = idSchema.optional().parse(args[1] ?? undefined);
      const chat = chatId ? await projectChats.get(chatId) : null;
      if (chat && chat.projectId !== id)
        throw new Error("That thread belongs to another project.");
      // A worktree thread reports its own branch; a removed one, the checkout's.
      const root =
        chat?.worktree?.path && !chat.worktree.removedAt
          ? await projectChats
              .worktreePath(chatId!)
              .catch(() => projects.root(id))
          : await projects.root(id);
      return ci.status(root, ctx.login.client);
    },
    projectBranchPulls: pullRequests,
    projectPreparePull: pullRequests,
    projectCreatePull: pullRequests,
    projectPulls: async (args) => {
      const client = requireClient();
      const repo = await projects.linked(idSchema.parse(args[0]), client);
      const page = await client.page<Pull>(
        `${client.repo(repo)}/pulls?state=${z.enum(["open", "closed", "all"]).parse(args[1])}`,
        pageSchema.parse(args[2]),
      );
      return {
        ...page,
        items: page.items.map((p) => ({
          ...p,
          repository: {
            name: repo.name,
            full_name: `${repo.owner}/${repo.name}`,
            owner: repo.owner,
          },
          pull_request: { merged: p.merged },
        })),
      };
    },
  } satisfies Handlers;
}
