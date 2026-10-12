import { memo } from "react";
import { Popover } from "@base-ui/react/popover";
import { usePinOnClick } from "../../lib/usePinOnClick";
import { formatCost, type ThreadCost } from "../../../shared/thread-cost";
import "../agents/composer-model-picker.css";

/**
 * What the thread's answers cost so far, beside the send button, for an agent
 * billed per token; hovering splits it by model.
 */
export const ThreadCostButton = memo(function ThreadCostButton({
  cost,
}: {
  cost: ThreadCost;
}) {
  const pinOnClick = usePinOnClick();
  const total = formatCost(cost.usd);
  return (
    <Popover.Root onOpenChange={pinOnClick}>
      <Popover.Trigger
        openOnHover
        delay={150}
        closeDelay={150}
        type="button"
        className="composer-control credit-trigger"
        aria-label={`This thread cost ${total}`}
      >
        {total}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="composer-popup-positioner"
          side="top"
          align="end"
          sideOffset={6}
        >
          <Popover.Popup className="composer-select-popup usage-ring-popup credit-popup">
            <div className="credit-thread">
              <span>This thread</span>
              <span>{total}</span>
            </div>
            {cost.models.map((m) => (
              <div key={m.name} className="thread-cost-model">
                <span>{m.name}</span>
                <span>{formatCost(m.usd)}</span>
              </div>
            ))}
            <p className="usage-ring-status">
              {cost.answers} {cost.answers === 1 ? "answer" : "answers"} · priced
              by the agent
            </p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
});
