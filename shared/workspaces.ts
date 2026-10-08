import { z } from "zod";

// Where Git and file calls work: a project's checkout, or one thread's
// worktree of it. Panes carry this in place of a bare project id, so the
// same pane follows whichever folder the thread works in.

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const workspaceIdSchema = z
  .string()
  .regex(new RegExp(`^${uuid}(/${uuid}(\\?worktree=[^?&#\\s]+)?)?$`, "i"))
  .refine((id) => {
    try {
      parseWorkspaceId(id);
      return true;
    } catch {
      return false;
    }
  });

export const workspaceId = (
  projectId: string,
  chatId?: string,
  worktree?: string,
) =>
  chatId
    ? `${projectId}/${chatId}${worktree ? `?worktree=${encodeURIComponent(worktree)}` : ""}`
    : projectId;

export function parseWorkspaceId(id: string) {
  const [path, worktree] = id.split("?worktree=");
  const [projectId, chatId] = path.split("/");
  return {
    projectId,
    chatId: chatId as string | undefined,
    ...(worktree ? { worktree: decodeURIComponent(worktree) } : {}),
  };
}
