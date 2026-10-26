import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { folderInputSchema } from "../../shared/projects";
import { videoMime } from "../../shared/project-files";
import { digestSchema, shaSchema, textSchema } from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import { workspaceIdSchema } from "../../shared/workspaces";
import { saveKept } from "../local-history";
import { mediaUrl } from "../media";
import { expandHome } from "../projects/folder-inspect";
import {
  entryPath,
  fileInfo,
  listDirectory,
  readImage,
} from "../projects/project-files";
import { takes, type ApiContext, type Handlers } from "./context";

export const folderPathSchema = workingPathSchema.or(z.literal(""));
/** Where a file call works: a workspace, or the folder of a file outside every project. */
export const fileRootSchema = workspaceIdSchema.or(folderInputSchema);

/** A file outside the project, one an answer names or in a linked folder, opens from its folder, like a plain one. */
export async function fileRoot(place: ApiContext["place"], where: string) {
  return workspaceIdSchema.safeParse(where).success
    ? place(where)
    : { root: await realpath(expandHome(where)), plain: true };
}

/** Browsing and editing a project's files, or a folder outside every project. */
export function projectFileHandlers(ctx: ApiContext) {
  const { projects, place } = ctx;
  const rootOf = (where: string) => fileRoot(place, where);
  return {
    projectFiles: takes([workspaceIdSchema], async (where) =>
      projects.files(await place(where)),
    ),
    projectDirectory: takes(
      [fileRootSchema, folderPathSchema],
      async (where, dir) => {
        const { root, plain } = await rootOf(where);
        return listDirectory(root, dir, plain);
      },
    ),
    projectFileInfo: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => fileInfo((await rootOf(where)).root, path),
    ),
    projectImage: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => readImage((await rootOf(where)).root, path),
    ),
    projectVideo: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => {
        const { root } = await rootOf(where);
        const full = await entryPath(root, path);
        if (!videoMime(full)) throw new Error("That is not a video.");
        return mediaUrl(full, root);
      },
    ),
    projectAbsolutePath: takes(
      [workspaceIdSchema, workingPathSchema],
      async (where, path) => join((await place(where)).root, path),
    ),
    projectFile: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => projects.file(await rootOf(where), path),
    ),
    projectFilePreview: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => projects.filePreview(await rootOf(where), path),
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
      async (where, path, head, version, contents) => {
        const place = await rootOf(where);
        return saveKept(place.root, path, contents, () =>
          projects.save(place, path, head, version, contents),
        );
      },
    ),
  } satisfies Handlers;
}
