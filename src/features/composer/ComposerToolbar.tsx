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
 * draggable; the caller owns the `.composer-tools` row and what ends it.
 */
export function ComposerToolbar({
  layout,
  controls,
  wrap,
}: {
  layout: ToolbarLayout;
  controls: ToolbarControls;
  wrap?: (slot: ToolbarSlot, node: ReactNode) => ReactNode;
}) {
  return toolbarRun(layout, (item) => !!controls[item]).map(
    ({ slot, divider }) => {
      const node =
        slot === "gap" ? <span className="spacer" /> : controls[slot];
      return (
        <Fragment key={slot}>
          {divider && <span className="composer-divider" aria-hidden />}
          {wrap ? wrap(slot, node) : node}
        </Fragment>
      );
    },
  );
}
