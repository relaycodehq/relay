import { openPath } from "./open-path";
import { app, dialog, nativeImage, shell } from "electron";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { agentProviderSchema } from "../../shared/agents";
import { chatIsEmpty } from "../../shared/chat-activity";
import { projectFolderSchema } from "../../shared/project-folders";
import {
  projectNameSchema,
  projectSettingsSchema,
} from "../../shared/projects";
import {
  checkNewLinks,
  inspectFolder,
  linkSuggestions,
  listFolders,
} from "../projects/folder-inspect";
import { newProjectSchema } from "../../shared/projects";
import { githubRepos } from "../project-add";
import { createPullRequestSchema } from "../../shared/pull-request-create";
import { isSourceControlOn } from "../../shared/source-control";
import {
  digestSchema,
  idSchema,
  shaSchema,
  textSchema,
} from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import { workspaceIdSchema } from "../../shared/workspaces";
import { imageMime } from "../../shared/project-files";
import { agentRuntime } from "../agents";
import {
  createEntry,
  entryPath,
  fileInfo,
  listDirectory,
  readImage,
  renameEntry,
} from "../projects/project-files";
import { projectIcon } from "../projects/project-icon";
import { branchPulls } from "../pull-requests/pull-request-create";
import { pageSchema, takes, type ApiContext, type Handlers } from "./context";

/** The project list and its folders, files, agents, and pull requests. */
const folderPathSchema = workingPathSchema.or(z.literal(""));
/** A folder on disk as typed: absolute, or from `~`. */
const folderInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((v) => /^(~|\/|[a-zA-Z]:[\\/])/.test(v) && !v.includes("\0"));

export function projectHandlers(ctx: ApiContext) {
  const {
    projects,
    projectChats,
    ci,
    store,
    pullRequestCreation,
    clientFor,
    place,
  } = ctx;
  /** The project's repository and the client for its host. */
  async function projectRepo(projectId: string) {
    const known = projects.get(projectId).repository;
    if (!known)
      throw new Error(
        "Relay can't match this project to a GitHub or Gitea repository.",
      );
    const client = await clientFor(known);
    return { client, repo: await projects.linked(projectId, client) };
  }
  async function pullRequestPlace(where: string) {
    // A worktree thread's PR opens from its own branch.
    const { root, projectId, chatId } = await place(where);
    return { root, chatId, ...(await projectRepo(projectId)) };
  }
  return {
    projectIcon: takes([idSchema], async (id) =>
      projectIcon(await projects.root(id), (path) => {
        const image = nativeImage.createFromPath(path);
        return image.isEmpty()
          ? null
          : image.resize({ width: 128, quality: "best" }).toDataURL();
      }),
    ),
    projectGroups: () => projects.groups(),
    createProjectGroup: takes([projectFolderSchema], (path) =>
      projects.createGroup(path),
    ),
    renameProjectGroup: takes(
      [projectFolderSchema, projectFolderSchema],
      (from, to) => projects.renameGroup(from, to),
    ),
    removeProjectGroup: takes([projectFolderSchema], (path) =>
      projects.removeGroup(path),
    ),
    moveProjectGroup: takes(
      [projectFolderSchema, projectFolderSchema.nullable()],
      (path, before) => projects.moveGroup(path, before),
    ),
    moveProject: takes(
      [idSchema, projectFolderSchema, idSchema.nullable()],
      (id, folder, before) => projects.move(id, folder, before),
    ),
    renameProject: takes([idSchema, projectNameSchema], (id, name) =>
      projects.rename(id, name),
    ),
    removeProject: takes([idSchema], async (id) => {
      const running = projectChats.list(id).filter((c) => c.running).length;
      if (running)
        throw new Error(
          `Stop the ${running === 1 ? "running thread" : `${running} running threads`} first.`,
        );
      await projects.remove(id);
    }),
    saveProjectSettings: takes(
      [idSchema, projectSettingsSchema],
      async (id, settings) => {
        await checkNewLinks(settings.links, projects.get(id).settings?.links);
        const saved = await projects.saveSettings(id, settings);
        projectChats.summariesChanged(id);
        return saved;
      },
    ),
    revealProject: takes([idSchema], (id) => openPath(projects.root(id))),
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
    inspectFolder: takes([folderInputSchema], inspectFolder),
    listFolders: takes([folderInputSchema], (dir) =>
      listFolders(dir).catch(() => []),
    ),
    chooseFolder: takes([z.string().max(200)], async (title) => {
      const result = await dialog.showOpenDialog(ctx.window.win!, {
        title,
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    }),
    linkSuggestions: takes([idSchema], async (id) =>
      linkSuggestions(projects.get(id), await projects.list(ctx.login.client)),
    ),
    addingStart: () => ctx.projectAdding.start(),
    addProjectAt: takes(
      [folderInputSchema, z.boolean().optional()],
      (path, setUpGit) => ctx.projectAdding.addAt(path, setUpGit),
    ),
    cloneProject: takes(
      [z.string().trim().min(1).max(2000), folderInputSchema],
      (remote, into) => ctx.projectAdding.clone(remote, into),
    ),
    createProject: takes(
      [newProjectSchema.extend({ location: folderInputSchema })],
      (spec) => ctx.projectAdding.create(spec),
    ),
    cancelProjectAdding: () => ctx.projectAdding.cancel(),
    githubRepos: () => githubRepos(),
    createScratch: () =>
      projects.scratch(join(app.getPath("userData"), "Scratchpad"), (id) =>
        projectChats.list(id).some((c) => !chatIsEmpty(c)),
      ),
    scratchChats: () =>
      projects
        .scratchIds()
        .flatMap((id) => projectChats.list(id))
        .sort((a, b) => b.updated - a.updated),
    linkProject: takes([idSchema], (id) => projects.link(id, ctx.login.client)),
    projectCommands: takes(
      [idSchema, agentProviderSchema],
      async (id, provider) =>
        agentRuntime(provider).commands(await projects.root(id)),
    ),
    agentModels: takes([agentProviderSchema], (provider) =>
      agentRuntime(provider).models(),
    ),
    agentDefaults: takes(
      [idSchema, agentProviderSchema],
      async (id, provider) =>
        agentRuntime(provider).defaults(await projects.root(id)),
    ),
    projectFiles: takes([workspaceIdSchema], async (where) =>
      projects.files(await place(where)),
    ),
    projectDirectory: takes(
      [workspaceIdSchema, folderPathSchema],
      async (where, dir) => {
        const { root, plain } = await place(where);
        return listDirectory(root, dir, plain);
      },
    ),
    projectFileInfo: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => fileInfo((await place(where)).root, path),
    ),
    projectImage: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => readImage((await place(where)).root, path),
    ),
    projectThumbnail: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => {
        const { root } = await place(where);
        const image = imageMime(path)
          ? nativeImage.createFromPath(await entryPath(root, path))
          : null;
        // What the system can't decode (SVG, say) goes as it is.
        if (!image || image.isEmpty()) return readImage(root, path);
        return image.getSize().width <= 320
          ? readImage(root, path)
          : image.resize({ width: 320, quality: "good" }).toDataURL();
      },
    ),
    revealProjectPath: takes(
      [workspaceIdSchema, folderPathSchema],
      async (where, path) => {
        const full = await entryPath((await place(where)).root, path);
        // A folder opens in Finder to show what's inside; a file is selected in its folder.
        if (await lstat(full).then((s) => s.isDirectory())) {
          await openPath(full);
        } else shell.showItemInFolder(full);
      },
    ),
    projectAbsolutePath: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => join((await place(where)).root, path),
    ),
    openProjectPath: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) =>
        openPath(entryPath((await place(where)).root, path)),
    ),
    createProjectEntry: takes(
      [workspaceIdSchema, workingPathSchema, z.enum(["file", "dir"])],
      async (where, path, kind) =>
        createEntry((await place(where)).root, path, kind),
    ),
    renameProjectEntry: takes(
      [workspaceIdSchema, workingPathSchema, workingPathSchema],
      async (where, from, to) =>
        renameEntry((await place(where)).root, from, to),
    ),
    trashProjectEntry: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) =>
        shell.trashItem(await entryPath((await place(where)).root, path)),
    ),
    projectFile: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => projects.file(await place(where), path),
    ),
    saveProjectFile: takes(
      [
        workspaceIdSchema,
        workingPathSchema,
        // A plain folder has no HEAD.
        shaSchema.or(z.literal("")),
        digestSchema,
        textSchema,
      ],
      async (where, path, head, version, contents) =>
        projects.save(await place(where), path, head, version, contents),
    ),
    projectCiStatus: takes(
      [idSchema, idSchema.nullish()],
      async (id, chatId) => {
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
        const settings = store.get().sourceControl;
        return ci.status(root, ctx.login.client, (kind) =>
          isSourceControlOn(settings, kind),
        );
      },
    ),
    projectBranchPulls: takes([workspaceIdSchema], async (where) => {
      const { root, client, repo } = await pullRequestPlace(where);
      return branchPulls(root, client, repo);
    }),
    projectPreparePull: takes([workspaceIdSchema], async (where) => {
      const { root, client, repo } = await pullRequestPlace(where);
      return pullRequestCreation.prepare(root, client, repo);
    }),
    projectCreatePull: takes(
      [workspaceIdSchema, createPullRequestSchema],
      async (where, input) => {
        const { root, chatId, client } = await pullRequestPlace(where);
        const created = await pullRequestCreation.create(root, client, input);
        if (chatId)
          await projectChats.recordPull(chatId, {
            number: created.pull.ref.number,
            url: created.pull.url,
          });
        return created;
      },
    ),
    projectPulls: takes(
      [idSchema, z.enum(["open", "closed", "all"]), pageSchema],
      async (id, state, page) => {
        const { client, repo } = await projectRepo(id);
        const pulls = await client.pulls(repo, state, page);
        return {
          ...pulls,
          items: pulls.items.map((p) => ({
            ...p,
            repository: {
              name: repo.name,
              full_name: `${repo.owner}/${repo.name}`,
              owner: repo.owner,
              ...(repo.server ? { server: repo.server } : {}),
            },
            pull_request: { merged: p.merged },
          })),
        };
      },
    ),
  } satisfies Handlers;
}
