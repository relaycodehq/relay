import { openPath } from "./open-path";
import {
  importAppSchema,
  importSelectionSchema,
} from "../../shared/project-import";
import { runImportOfferSchema } from "../../shared/import-offer";
import { app, dialog, nativeImage, shell } from "electron";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { agentProviderSchema } from "../../shared/agents";
import { CHECKS_MEMORY_MB } from "../../shared/checks";
import { chatIsEmpty } from "../../shared/chat-activity";
import { projectFolderSchema } from "../../shared/project-folders";
import {
  linkedFoldersSchema,
  projectNameSchema,
  projectSettingsSchema,
  threadWorktree,
} from "../../shared/projects";
import {
  checkNewLinks,
  expandHome,
  folderPreview,
  inspectFolder,
  linkSuggestions,
  listFolders,
} from "../projects/folder-inspect";
import { folderInputSchema, newProjectSchema } from "../../shared/projects";
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
import { videoMime } from "../../shared/project-files";
import { mediaUrl } from "../media";
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
import {
  computerIdSchema,
  pageSchema,
  remoteProjects,
  takes,
  type ApiContext,
  type Handlers,
} from "./context";

/** The project list and its folders, files, agents, and pull requests. */
const folderPathSchema = workingPathSchema.or(z.literal(""));
/** Where a file call works: a workspace, or the folder of a file outside every project. */
const fileRootSchema = workspaceIdSchema.or(folderInputSchema);

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
        "Relay can't match this project to a repository on its host.",
      );
    const client = await clientFor(known);
    return { client, repo: await projects.linked(projectId, client) };
  }
  /** A file an answer names outside the project opens from its own folder, like a plain one. */
  async function fileRoot(where: string) {
    return workspaceIdSchema.safeParse(where).success
      ? place(where)
      : { root: await realpath(expandHome(where)), plain: true };
  }
  async function pullRequestPlace(where: string) {
    // A worktree thread's PR opens from its own branch.
    const { root, projectId, chatId } = await place(where);
    return { root, chatId, ...(await projectRepo(projectId)) };
  }
  return {
    importProjects: takes([importAppSchema], (app) =>
      projectChats.imports.list(app),
    ),
    importProjectChats: takes(
      [
        importAppSchema,
        z.string().min(1).max(100),
        folderInputSchema.nullish().transform((value) => value ?? undefined),
      ],
      (app, key, folder) => projectChats.imports.chats(app, key, folder),
    ),
    importSelectedProjects: takes(
      [importAppSchema, z.array(importSelectionSchema).min(1).max(1000)],
      (app, selections) => projectChats.imports.run(app, selections),
    ),
    startImportThread: takes([importAppSchema], async (source) => {
      const project = await projects.scratch(
        join(app.getPath("userData"), "Scratchpad"),
        (id) => projectChats.list(id).some((c) => !chatIsEmpty(c)),
      );
      const made = await projectChats.create(project.id, { kind: "project" });
      return {
        project,
        chat: await projectChats.importOffers.open(made.id, source),
      };
    }),
    runImportOffer: takes(
      [idSchema, z.string().min(1).max(200), runImportOfferSchema],
      (chatId, messageId, input) =>
        projectChats.importOffers.run(chatId, messageId, input),
    ),
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
    locateProject: takes([idSchema], async (id) => {
      const result = await dialog.showOpenDialog(ctx.window.caller()!, {
        title: `Locate the folder of ${projects.get(id).name}`,
        properties: ["openDirectory"],
      });
      return result.canceled
        ? null
        : projects.relocate(id, result.filePaths[0]!);
    }),
    saveProjectSettings: takes(
      [idSchema, projectSettingsSchema],
      async (id, settings) => {
        const current = projects.get(id);
        if (settings.links)
          settings.links = await checkNewLinks(
            settings.links,
            current.settings?.links,
            current.path,
          );
        const saved = await projects.saveSettings(id, settings);
        projectChats.summariesChanged(id);
        ctx.projectChecks.relimit(
          id,
          settings.checksMemoryMb ?? CHECKS_MEMORY_MB,
        );
        return saved;
      },
    ),
    addProjectLinks: takes(
      [idSchema, linkedFoldersSchema],
      async (id, links) => {
        const current = projects.get(id);
        const added = await checkNewLinks(
          links,
          current.settings?.links,
          current.path,
        );
        const saved = await projects.updateLinks(id, (kept) => {
          const paths = new Set(kept.map((l) => l.path));
          return [...kept, ...added.filter((l) => !paths.has(l.path))];
        });
        projectChats.summariesChanged(id);
        return saved;
      },
    ),
    revealProject: takes([idSchema], (id) => openPath(projects.root(id))),
    projects: () => projects.list(ctx.login.client),
    removedProjects: () => projects.removedIds(),
    addProject: async () => {
      const result = await dialog.showOpenDialog(ctx.window.caller()!, {
        title: "Add a project folder",
        properties: ["openDirectory"],
      });
      return result.canceled
        ? null
        : projects.add(result.filePaths[0], ctx.login.client);
    },
    inspectFolder: takes([folderInputSchema], inspectFolder),
    listFolders: takes([folderInputSchema], (dir) => listFolders(dir)),
    folderPreview: takes(
      [folderInputSchema, computerIdSchema],
      (dir, computerId) =>
        computerId
          ? remoteProjects(ctx).ask(computerId, "folderPreview", dir)
          : folderPreview(dir),
    ),
    chooseFolder: takes([z.string().max(200)], async (title) => {
      const result = await dialog.showOpenDialog(ctx.window.caller()!, {
        title,
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    }),
    linkSuggestions: takes([idSchema], async (id) =>
      linkSuggestions(projects.get(id), await projects.list(ctx.login.client)),
    ),
    addingStart: takes([computerIdSchema], (computerId) =>
      computerId
        ? remoteProjects(ctx).ask(computerId, "addingStart")
        : ctx.projectAdding.start(),
    ),
    addProjectAt: takes(
      [folderInputSchema, z.boolean().optional()],
      (path, setUpGit) => ctx.projectAdding.addAt(path, setUpGit),
    ),
    cloneProject: takes(
      [z.string().trim().min(1).max(2000), folderInputSchema],
      (remote, into) => ctx.projectAdding.clone(remote, into),
    ),
    createProject: takes(
      [
        newProjectSchema.extend({ location: folderInputSchema }),
        computerIdSchema,
      ],
      async (spec, computerId) =>
        computerId
          ? remoteProjects(ctx).adopt(
              computerId,
              await remoteProjects(ctx).ask(computerId, "createProject", spec),
            )
          : ctx.projectAdding.create(spec),
    ),
    cancelProjectAdding: takes([computerIdSchema], (computerId) =>
      computerId
        ? remoteProjects(ctx).ask(computerId, "cancelProjectAdding")
        : ctx.projectAdding.cancel(),
    ),
    githubRepos: takes([computerIdSchema], (computerId) =>
      computerId
        ? remoteProjects(ctx).ask(computerId, "githubRepos")
        : githubRepos(),
    ),
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
    agentModels: takes(
      [agentProviderSchema, computerIdSchema],
      (provider, computerId) =>
        // A project on a paired computer runs that computer's own copy.
        computerId
          ? remoteProjects(ctx).agentModels(computerId, provider)
          : agentRuntime(provider).models(),
    ),
    reloadAgentModels: takes(
      [agentProviderSchema, z.boolean(), computerIdSchema],
      async (provider, stopRunning, computerId) => {
        if (computerId)
          return remoteProjects(ctx).ask(
            computerId,
            "reloadAgentModels",
            provider,
            stopRunning,
          );
        const running = projectChats.runningOn(provider);
        if (running.length && !stopRunning) return { running };
        let stopped: string[] = [];
        try {
          await agentRuntime(provider).reloadModels?.(async () => {
            stopped = await projectChats.stopRunningOn(provider);
          });
        } finally {
          await projectChats.resumeStopped(stopped);
        }
        return { running: [] };
      },
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
      [fileRootSchema, workingPathSchema],
      async (where, path) => fileInfo((await fileRoot(where)).root, path),
    ),
    projectImage: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => readImage((await fileRoot(where)).root, path),
    ),
    projectVideo: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => {
        const { root } = await fileRoot(where);
        const full = await entryPath(root, path);
        if (!videoMime(full)) throw new Error("That is not a video.");
        return mediaUrl(full, root);
      },
    ),
    revealProjectPath: takes(
      [fileRootSchema, folderPathSchema],
      async (where, path) => {
        const full = await entryPath((await fileRoot(where)).root, path);
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
      [fileRootSchema, workingPathSchema],
      async (where, path) =>
        openPath(entryPath((await fileRoot(where)).root, path)),
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
      [fileRootSchema, workingPathSchema],
      async (where, path) => projects.file(await fileRoot(where), path),
    ),
    projectFilePreview: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => projects.filePreview(await fileRoot(where), path),
    ),
    saveProjectFile: takes(
      [
        fileRootSchema,
        workingPathSchema,
        // A plain folder has no HEAD.
        shaSchema.or(z.literal("")),
        digestSchema,
        textSchema,
      ],
      async (where, path, head, version, contents) =>
        projects.save(await fileRoot(where), path, head, version, contents),
    ),
    projectCiStatus: takes(
      [idSchema, idSchema.nullish()],
      async (id, chatId) => {
        const chat = chatId ? await projectChats.get(chatId) : null;
        if (chat && chat.projectId !== id)
          throw new Error("That thread belongs to another project.");
        // A worktree thread reports its own branch; a removed one, the checkout's.
        const root = threadWorktree(chat ?? undefined)
          ? await projectChats
              .worktreeRoot(id, chatId!)
              .catch(() => projects.root(id))
          : await projects.root(id);
        const settings = store.get().sourceControl;
        return ci.status(
          root,
          {
            gitea: ctx.login.client,
            azure: (server) => ctx.hosts.azureClient(server),
          },
          (kind) => isSourceControlOn(settings, kind),
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
