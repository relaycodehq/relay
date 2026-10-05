import type { ChatMessage, SessionReload } from "../../../shared/projects";
import { reloadDetail, reloadNote } from "../../../shared/session-reload";

/** The line where the agent restarted on the same conversation; hovering it names what came and went. */
export function SessionReloadRow({
  message: m,
  reload,
}: {
  message: ChatMessage;
  reload: SessionReload;
}) {
  return (
    <div className="context-compaction" data-message-id={m.id} role="status">
      <span title={reloadDetail(reload)}>
        {reloadNote(reload, m.status === "streaming")}
      </span>
    </div>
  );
}
