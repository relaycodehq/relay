import { z } from "zod";
import {
  editorFileTargetSchema,
  unsavedBuffersSchema,
} from "../../shared/editor-windows";
import { parseWorkspaceId, workspaceIdSchema } from "../../shared/workspaces";
import { takes, type ApiContext, type Handlers } from "./context";

const idSchema = z.string().min(1).max(200);

/** Workspaces' editors popped out of the main window into windows of their own. */
export function editorWindowHandlers(ctx: ApiContext) {
  const { window, store } = ctx;
  /** The workspace, as long as its project is still there. */
  const workspace = (projectId: string, where: string) => {
    const project = store.get().projects?.find((p) => p.id === projectId);
    if (
      !project ||
      project.removed ||
      parseWorkspaceId(where).projectId !== projectId
    )
      throw new Error("That project isn't here anymore.");
    return { projectId, where };
  };
  return {
    editorWindows: () => window.editors.state(),
    openEditorWindow: takes(
      [idSchema, workspaceIdSchema, unsavedBuffersSchema.optional()],
      (projectId, where, buffers) =>
        window.editors.popOut(
          workspace(projectId, where),
          window.caller(),
          buffers,
        ),
    ),
    returnEditorWindow: takes(
      [workspaceIdSchema, unsavedBuffersSchema.optional()],
      (where, buffers) =>
        window.editors.giveBack(where, window.caller(), buffers),
    ),
    openInEditorWindow: takes(
      [workspaceIdSchema, editorFileTargetSchema],
      (where, target) => window.editors.openFile(where, target),
    ),
    takeEditorHandoff: takes([workspaceIdSchema], (where) =>
      window.editors.take(where, window.caller()),
    ),
  } satisfies Handlers;
}
