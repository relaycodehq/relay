import { lstat } from "node:fs/promises";
import { shell } from "electron";
import { z } from "zod";
import { openWithAppIdSchema } from "../../shared/open-with";
import { workingPathSchema } from "../../shared/working-tree";
import { openWith, openWithApps } from "../open-with";
import { entryPath, createEntry, renameEntry } from "../projects/project-files";
import { takes, type ApiContext, type Handlers } from "./context";
import { openPath } from "./open-path";
import { fileRoot, fileRootSchema, folderPathSchema } from "./project-files";

/** Revealing, opening, creating, renaming and trashing the entries of a project's folders. */
export function projectEntryHandlers(ctx: ApiContext) {
  const rootOf = (where: string) => fileRoot(ctx.place, where);
  return {
    revealProjectPath: takes(
      [fileRootSchema, folderPathSchema],
      async (where, path) => {
        const full = await entryPath((await rootOf(where)).root, path);
        // A folder opens in Finder to show what's inside; a file is selected in its folder.
        if (await lstat(full).then((s) => s.isDirectory())) {
          await openPath(full);
        } else shell.showItemInFolder(full);
      },
    ),
    openProjectPath: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) =>
        openPath(entryPath((await rootOf(where)).root, path)),
    ),
    openWithApps: () => openWithApps(),
    openProjectPathWith: takes(
      [fileRootSchema, workingPathSchema, openWithAppIdSchema],
      async (where, path, appId) =>
        openWith(appId, await entryPath((await rootOf(where)).root, path)),
    ),
    createProjectEntry: takes(
      [fileRootSchema, workingPathSchema, z.enum(["file", "dir"])],
      async (where, path, kind) =>
        createEntry((await rootOf(where)).root, path, kind),
    ),
    renameProjectEntry: takes(
      [fileRootSchema, workingPathSchema, workingPathSchema],
      async (where, from, to) =>
        renameEntry((await rootOf(where)).root, from, to),
    ),
    trashProjectEntry: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) =>
        shell.trashItem(await entryPath((await rootOf(where)).root, path)),
    ),
  } satisfies Handlers;
}
