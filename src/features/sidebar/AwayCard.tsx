// Activity cards of threads handed off to another computer: the computer on
// the meta line, and a peek on hover. useAwayViews lays its state over the card.
// A thread popped out into its own window says so on the same line.
import type { ReactElement } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { AppWindow, MonitorOff, MonitorUp } from "lucide-react";
import type { HandoffView } from "../../../shared/handoff";
import { canPeek, RemotePeek } from "../handoff/RemotePeek";
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
  const { computer } = view.sentTo;
  return view.online ? (
    <span className="sb-card-where" title={`On ${computer}`}>
      <MonitorUp size={11} />
      {computer}
    </span>
  ) : (
    <span
      className="sb-card-where offline"
      title={`Can't reach ${computer} right now`}
    >
      <MonitorOff size={11} />
      {computer}
    </span>
  );
}

/** Hovering the card shows what the other computer is doing, beside the sidebar. */
export function AwayPeek({
  view,
  children,
}: {
  view?: HandoffView;
  children: ReactElement;
}) {
  if (!view || !canPeek(view)) return children;
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger render={children} delay={400} closeDelay={150} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={12}
        >
          <PreviewCard.Popup
            className="subagents-card remote-peek-card"
            aria-label={`What ${view.sentTo.computer} is doing`}
          >
            <RemotePeek view={view} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
