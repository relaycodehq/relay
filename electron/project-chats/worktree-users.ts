import type { ChatSummary, ProjectChat } from "../../shared/projects";
import { reviewFolder, threadsSharing } from "../../shared/projects";
import { sameFolder } from "../git/worktrees";

/**
 * Everyone else working in the thread's worktree folder: the open threads
 * sharing it, and the open reviews that followed their branch into it,
 * fixes and all. While there are any, the folder stays.
 */
export async function worktreeUsers(
  chats: readonly ChatSummary[],
  chat: Pick<ProjectChat, "id" | "worktree">,
) {
  const sharing = threadsSharing(chats, chat);
  const path = chat.worktree?.path;
  if (!path || chat.worktree!.removedAt) return sharing;
  const reviews: ChatSummary[] = [];
  for (const c of chats) {
    const folder = reviewFolder(c);
    if (!folder || c.id === chat.id || c.archivedAt || sharing.includes(c))
      continue;
    if (await sameFolder(folder.path, path)) reviews.push(c);
  }
  return [...sharing, ...reviews];
}

/** Why the thread's worktree folder stays when the thread lets go of it, if it does. */
export async function whyFolderStays(
  chats: readonly ChatSummary[],
  chat: ProjectChat,
): Promise<
  { adopted?: true; users: readonly { title: string }[] } | undefined
> {
  if (chat.worktree?.adopted) return { adopted: true, users: [] };
  const users = await worktreeUsers(chats, chat);
  return users.length ? { users } : undefined;
}
