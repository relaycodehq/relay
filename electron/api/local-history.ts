import { realpath } from "node:fs/promises";
import { z } from "zod";
import {
  localHistoryLabelSchema,
  localHistoryReasonSchema,
} from "../../shared/local-history";
import { digestSchema, textSchema } from "../../shared/validation";
import { workingPathSchema } from "../../shared/working-tree";
import { workspaceIdSchema } from "../../shared/workspaces";
import { folderInputSchema } from "../../shared/projects";
import { expandHome } from "../projects/folder-inspect";
import { historyKey, localHistory, revertToVersion } from "../local-history";
import { takes, type ApiContext, type Handlers } from "./context";

/** Where a file call works: a workspace, or the folder of a file outside every project. */
const fileRootSchema = workspaceIdSchema.or(folderInputSchema);
const versionIdSchema = z.string().min(1).max(100);

/** Local History: the versions Relay kept of a file, whatever Git says. */
export function localHistoryHandlers(ctx: ApiContext) {
  async function folderOf(where: string) {
    return workspaceIdSchema.safeParse(where).success
      ? (await ctx.place(where)).root
      : realpath(expandHome(where));
  }
  async function keyOf(where: string, path: string) {
    return historyKey(await folderOf(where), path);
  }
  function history() {
    const store = localHistory();
    if (!store) throw new Error("Local History isn't available here.");
    return store;
  }
  return {
    localHistoryList: takes(
      [fileRootSchema, workingPathSchema],
      async (where, path) => history().list(await keyOf(where, path)),
    ),
    localHistoryRead: takes(
      [fileRootSchema, workingPathSchema, versionIdSchema],
      async (where, path, id) => history().read(await keyOf(where, path), id),
    ),
    localHistoryRecord: takes(
      [
        fileRootSchema,
        workingPathSchema,
        textSchema,
        localHistoryReasonSchema,
        localHistoryLabelSchema.optional(),
      ],
      async (where, path, contents, reason, label) =>
        history().record(await keyOf(where, path), contents, reason, label),
    ),
    localHistoryRevert: takes(
      [
        fileRootSchema,
        workingPathSchema,
        versionIdSchema,
        // A file that's gone has no version.
        digestSchema.or(z.literal("")),
      ],
      async (where, path, id, currentVersion) => {
        const folder = await realpath(await folderOf(where));
        return revertToVersion(
          history(),
          folder,
          path,
          await historyKey(folder, path),
          id,
          currentVersion,
        );
      },
    ),
  } satisfies Handlers;
}
