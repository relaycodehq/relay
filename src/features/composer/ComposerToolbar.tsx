import { Fragment, type ReactNode } from "react";
import {
  toolbarRun,
  type ToolbarItem,
  type ToolbarLayout,
  type ToolbarSlot,
} from "./composer-toolbar";

/** Each control's element; empty where this composer doesn't offer it. */
export type ToolbarControls = Partial<
  Record<ToolbarItem, ReactNode | false | null>
>;

/**
 * The composer's controls in the user's order, with dividers between the
 * labelled ones and a spacer at the gap. `wrap` lets Settings make each slot
 * draggable; the caller owns the `.composer-tools` row. What follows the gap,
 * and `end` after it, stay together on the right, also when the row wraps.
 */
export function ComposerToolbar({
  layout,
  controls,
  wrap,
  end,
}: {
  layout: ToolbarLayout;
  controls: ToolbarControls;
  wrap?: (slot: ToolbarSlot, node: ReactNode) => ReactNode;
  end?: ReactNode;
}) {
  const run = toolbarRun(layout, (item) => !!controls[item]);
  const nodes = run.map(({ slot, divider }) => {
    const node = slot === "gap" ? <span className="spacer" /> : controls[slot];
    return (
      <Fragment key={slot}>
        {divider && <span className="composer-divider" aria-hidden />}
        {wrap ? wrap(slot, node) : node}
      </Fragment>
    );
  });
  if (wrap) return nodes;
  const gap = run.findIndex(({ slot }) => slot === "gap");
  return (
    <>
      {gap < 0 ? nodes : nodes.slice(0, gap)}
      <div className="composer-tools-end">
        {gap < 0 ? null : nodes.slice(gap + 1)}
        {end}
      </div>
    </>
  );
}
