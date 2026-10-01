// Activity cards of threads handed off to another computer: the computer on
// the meta line, and a peek on hover. lib/useAwayViews lays its state over the card.
import type { ReactElement } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { MonitorOff, MonitorUp } from "lucide-react";
import type { HandoffView } from "../../shared/handoff";
import { canPeek, RemotePeek } from "./RemotePeek";

export function AwayWhere({ view }: { view?: HandoffView }) {
  if (!view) return null;
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
