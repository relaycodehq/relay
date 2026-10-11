import type { ReactNode } from "react";
import type { ChatMessage, SessionReload } from "../../../shared/projects";
import { reloadDetail, reloadNote } from "../../../shared/session-reload";
import { LineDivider } from "../../ui/LineDivider";

/** The line where the agent restarted on the same conversation; hovering it names what came and went. */
export function SessionReloadRow({
  message: m,
  reload,
  unread,
}: {
  message: ChatMessage;
  reload: SessionReload;
  unread?: ReactNode;
}) {
  return (
    <LineDivider data-message-id={m.id} role="status">
      {unread}
      <span title={reloadDetail(reload)}>
        {reloadNote(reload, m.status === "streaming")}
      </span>
    </LineDivider>
  );
}
