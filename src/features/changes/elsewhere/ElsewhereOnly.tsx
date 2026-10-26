import { ErrorBox, Loading } from "../../../ui/ui";
import { ElsewhereGroups } from "./ElsewhereGroups";
import { useElsewhere, type ElsewherePick } from "./useElsewhere";
import "../working-tree.css";

/**
 * Changes for a thread whose folder has no Git, as a Scratchpad's: only
 * what its agents changed in other repositories, each with its own commit.
 * A file picked opens in the editor.
 */
export function ElsewhereOnly({
  chatId,
  onOpenThread,
  onPick,
}: {
  chatId: string;
  onOpenThread?: (chatId: string) => void;
  onPick: (pick: ElsewherePick) => void;
}) {
  const query = useElsewhere(chatId);
  const groups = query.data?.groups ?? [];
  if (query.error) return <ErrorBox error={query.error} />;
  if (query.isPending) return <Loading text="Reading changes elsewhere…" />;
  if (!groups.length)
    return <p className="working-empty">Nothing this thread changed is left uncommitted.</p>;
  return (
    <section className="local-changes list-only" aria-label="Changes elsewhere">
      <div className="working-content">
        <aside className="working-sidebar">
          <div className="working-file-list">
            <ElsewhereGroups
              chatId={chatId}
              groups={groups}
              selected={null}
              onPick={onPick}
              onOpenThread={onOpenThread}
            />
          </div>
        </aside>
      </div>
    </section>
  );
}
