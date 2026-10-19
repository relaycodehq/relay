// Activity cards of threads handed off to another computer: the computer on
// the meta line. A thread popped out into its own window says so there too.
import {
  AppWindow,
  MonitorOff,
  MonitorUp,
  Server,
  ServerOff,
} from "lucide-react";
import type { HandoffView } from "../../../shared/handoff";
import { useHasOwnWindow } from "../thread-windows/thread-windows";

export function AwayWhere({
  chatId,
  view,
}: {
  chatId: string;
  view?: HandoffView;
}) {
  const ownWindow = useHasOwnWindow(chatId);
  if (!view)
    return ownWindow ? (
      <span className="sb-card-where" title="Open in its own window">
        <AppWindow size={11} />
        Own window
      </span>
    ) : null;
  const { computer, home } = view.sentTo;
  // A thread of a project that lives there, rather than one sent there.
  const [On, Off] = home ? [Server, ServerOff] : [MonitorUp, MonitorOff];
  return view.online ? (
    <span className="sb-card-where" title={`On ${computer}`}>
      <On size={11} />
      {computer}
    </span>
  ) : (
    <span
      className="sb-card-where offline"
      title={`Can't reach ${computer} right now`}
    >
      <Off size={11} />
      {computer}
    </span>
  );
}
