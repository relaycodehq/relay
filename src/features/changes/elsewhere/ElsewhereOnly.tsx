import { useState } from "react";
import { ErrorBox, Loading } from "../../../ui/ui";
import { PaneResizer } from "../../../ui/PaneResizer";
import { ElsewhereGroups } from "./ElsewhereGroups";
import { ElsewhereReview } from "./ElsewhereReview";
import { useElsewhere, type ElsewherePick } from "./useElsewhere";
import "../working-tree.css";

/**
 * Changes for a thread whose folder has no Git, as a Scratchpad's: only
 * what its agents changed in other repositories, each with its own commit.
 */
export function ElsewhereOnly({
  chatId,
  onOpenThread,
  onOpenOutside,
}: {
  chatId: string;
  onOpenThread?: (chatId: string) => void;
  onOpenOutside?: (path: string) => void;
}) {
  const query = useElsewhere(chatId);
  const groups = query.data?.groups ?? [];
  const [pick, setPick] = useState<ElsewherePick | null>(null);
  const group = pick && groups.find((g) => g.root === pick.root);
  // Committed or reverted there, it has no diff left to show.
  const shown =
    pick && group?.files.some((f) => f.path === pick.path) ? pick : null;
  if (query.error) return <ErrorBox error={query.error} />;
  if (query.isPending) return <Loading text="Reading changes elsewhere…" />;
  if (!groups.length)
    return (
      <div className="empty pane-empty">
        <h2>Nothing this thread changed is left uncommitted.</h2>
      </div>
    );
  return (
    <section className="local-changes" aria-label="Changes elsewhere">
      <div className="working-content">
        <aside className="working-sidebar">
          <PaneResizer
            pane="changes"
            label="Resize changed files"
            initial={250}
            min={200}
            max={600}
          />
          <div className="working-file-list">
            <ElsewhereGroups
              chatId={chatId}
              groups={groups}
              selected={shown}
              onPick={setPick}
              onOpenThread={onOpenThread}
            />
          </div>
        </aside>
        {shown ? (
          <ElsewhereReview
            chatId={chatId}
            pick={shown}
            revision={group?.revision}
            onOpenOutside={onOpenOutside}
          />
        ) : (
          <div className="working-review">
            <div className="empty">
              <h2>Pick a file</h2>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
