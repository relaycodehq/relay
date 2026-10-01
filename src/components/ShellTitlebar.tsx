import { PanelBottom, PanelLeft } from "lucide-react";
import { useShortcutLabel } from "../lib/shortcuts";
import type { SidebarVisibility } from "../lib/useSidebarVisibility";
import type { ThreadTerminalDrawer } from "../lib/useThreadTerminal";
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

/** Shows or hides the thread's terminal drawer. */
export function TerminalToggle({
  terminal: { open, blocked, shown, toggle },
}: {
  terminal: ThreadTerminalDrawer;
}) {
  const keys = useShortcutLabel("terminal");
  return (
    <span
      title={
        blocked ?? `${open ? "Hide" : "Show"} terminal${keys && ` (${keys})`}`
      }
    >
      <button
        type="button"
        className={`pane-toggle ${shown ? "active" : ""}`}
        aria-label="Terminal"
        aria-pressed={shown}
        disabled={!!blocked}
        onClick={toggle}
      >
        <PanelBottom size={14} />
      </button>
    </span>
  );
}
