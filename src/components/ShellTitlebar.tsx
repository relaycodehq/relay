import { PanelLeft } from "lucide-react";
import { useShortcutLabel } from "../lib/shortcuts";
import type { SidebarVisibility } from "../lib/useSidebarVisibility";
import { RelayMark } from "./RelayMark";

/** The sidebar's toggle and the mark; the toggle echoes the sidebar's dot while it's hidden. */
export function TitlebarBrand({
  sidebar: { hidden, toggle, peekOpen, peekClose },
  attention,
  disabled,
}: {
  sidebar: SidebarVisibility;
  /** The sidebar's unread / needs-input dot. */
  attention?: "waiting" | "unread";
  disabled: boolean;
}) {
  const keys = useShortcutLabel("sidebar");
  const dot =
    hidden && attention
      ? attention === "waiting"
        ? "Needs your input"
        : "New activity"
      : undefined;
  return (
    <div className="project-titlebar-brand">
      <span className="traffic-space" />
      <button
        type="button"
        className="icon-button relay-sidebar-toggle"
        title={`${hidden ? "Show" : "Hide"} sidebar${keys && ` · ${keys}`}`}
        aria-label={
          (hidden ? "Show sidebar" : "Hide sidebar") + (dot ? ` · ${dot}` : "")
        }
        aria-pressed={!hidden}
        disabled={disabled}
        onClick={toggle}
        onMouseEnter={peekOpen}
        onMouseLeave={peekClose}
      >
        <PanelLeft size={16} />
        {dot && (
          <span
            className={`sb-status ${attention} relay-brand-dot`}
            aria-hidden="true"
          >
            <i />
          </span>
        )}
      </button>
      <RelayMark size={38} />
    </div>
  );
}
