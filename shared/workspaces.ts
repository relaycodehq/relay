import { z } from "zod";

// Where Git and file calls work: a project's checkout, or one thread's
// worktree of it. Panes carry this in place of a bare project id, so the
// same pane follows whichever folder the thread works in.

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const workspaceIdSchema = z
  .string()
  .regex(new RegExp(`^${uuid}(/${uuid})?$`, "i"));

export const workspaceId = (projectId: string, chatId?: string) =>
  chatId ? `${projectId}/${chatId}` : projectId;

export function parseWorkspaceId(id: string) {
  const [projectId, chatId] = id.split("/");
  return { projectId, chatId: chatId as string | undefined };
}
