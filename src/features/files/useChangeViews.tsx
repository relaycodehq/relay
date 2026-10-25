import type { ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { usePoll } from "../../lib/poll";
import { BranchChanges } from "../changes/BranchChanges";
import { ElsewhereOnly } from "../changes/elsewhere/ElsewhereOnly";
import { useElsewhere, type ElsewherePick } from "../changes/elsewhere/useElsewhere";
import { LocalChanges } from "../changes/LocalChanges";
import { worktreeQuery } from "../changes/turn-diff";
import { workingChange } from "./change-opens";
import type { SidebarView } from "./SidebarViews";
import { useChangeOpens } from "./useChangeOpens";
import type { EditorWorkspace } from "./useEditorWorkspace";
import type { FileBrowsing } from "./useFileBrowsing";

export type ThreadChangesProps = Pick<
  ComponentProps<typeof LocalChanges>,
  "chatId" | "agentRunning" | "onOpenThread" | "onAsk"
>;

/**
 * The sidebar's views of what changed: the folder's changes in a Git
 * project, only other repositories' in a folder without Git, and in a
 * worktree what it has that its branch doesn't. A change picked opens in the
 * editor with its changes in place; a failure to read one is returned to show.
 */
export function useChangeViews({
  where,
  plain,
  inWorktree,
  changeCount,
  shownPath,
  open,
  browsing,
  thread,
}: {
  where: string;
  plain: boolean;
  inWorktree?: boolean;
  changeCount?: number;
  shownPath: string | null;
  open: EditorWorkspace["open"];
  browsing: FileBrowsing;
  thread: ThreadChangesProps;
}) {
  const { chatId } = thread;
  const poll = usePoll();
  const worktree = useQuery(worktreeQuery(chatId, !!inWorktree, poll)).data;
  const branch =
    worktree?.path && !worktree.removed && worktree.from ? { ...worktree, from: worktree.from } : undefined;
  // A folder without Git lists only what its agents changed in other repositories.
  const elsewhere = useElsewhere(plain ? chatId : undefined).data;
  const { openChange, error } = useChangeOpens(browsing.show);
  const openElsewhere = (pick: ElsewherePick) =>
    openChange(async () => {
      const pair = await api.threadElsewhereDiff(chatId!, pick.root, pick.path);
      const path = `${pick.root}/${pick.path}`;
      return workingChange(pair, { path, outside: true }, "HEAD", `elsewhere:${path}`);
    });

  const views: SidebarView[] = [];
  if (!plain)
    views.push({
      id: "changes",
      label: "Changes",
      count: changeCount,
      content: (
        <LocalChanges
          projectId={where}
          onOpenChange={({ path }) => open({ path }, { changes: true })}
          onOpenElsewhere={openElsewhere}
          {...thread}
        />
      ),
    });
  if (plain && chatId && elsewhere?.groups.length)
    views.push({
      id: "changes",
      label: "Changes",
      count: elsewhere.groups.reduce((sum, group) => sum + group.files.length, 0),
      content: <ElsewhereOnly chatId={chatId} onOpenThread={thread.onOpenThread} onPick={openElsewhere} />,
    });
  if (branch && chatId)
    views.push({
      id: "branch",
      label: `Against ${branch.from}`,
      count: branch.files.length,
      content: (
        <BranchChanges
          chatId={chatId}
          where={where}
          status={branch}
          shownPath={shownPath}
          onPick={(path) =>
            openChange(async () => {
              const pair = await api.projectWorktreeDiff(chatId, path);
              return workingChange(pair, { path }, branch.from, `worktree:${chatId}:${path}`);
            })
          }
        />
      ),
    });
  return { views, error };
}
