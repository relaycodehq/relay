import type { ReactNode } from "react";
import { SIDEBAR_WIDTH } from "../lib/settings-page";
import { PaneResizer } from "../ui/PaneResizer";
import { ErrorBox } from "../ui/ui";
import type { SidebarVisibility } from "./useSidebarVisibility";

/**
 * The resizable column right of the activity bar. Folded, it floats over
 * the page and peeks out while the pointer is at the window's edge.
 */
export function ShellSidebar({
  sidebar,
  hidden,
  error,
  children,
}: {
  sidebar: SidebarVisibility;
  /** Covered by Settings, whose nav stands here instead. */
  hidden: boolean;
  error: unknown;
  children: ReactNode;
}) {
  const away = sidebar.hidden && !sidebar.peek;
  return (
    <aside
      ref={sidebar.asideRef}
      className={`projects-sidebar ${sidebar.hidden ? "overlay" : ""} ${sidebar.peek ? "peek" : ""}`}
      aria-label="Projects"
      aria-hidden={away || undefined}
      inert={away || undefined}
      hidden={hidden}
      onMouseEnter={sidebar.hidden ? sidebar.peekOpen : undefined}
      onMouseLeave={sidebar.hidden ? sidebar.peekClose : undefined}
    >
      <PaneResizer pane="sidebar" {...SIDEBAR_WIDTH} />
      {children}
      {!!error && <ErrorBox error={error} />}
    </aside>
  );
}
