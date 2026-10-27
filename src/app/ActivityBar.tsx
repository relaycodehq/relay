import type { ReactNode } from "react";
import {
  ChartColumn,
  GitPullRequest,
  MessagesSquare,
  Search,
  Settings2,
} from "lucide-react";
import { ClockifyTimer } from "../features/plugins/ClockifyTimer";
import { openThreadSearch } from "../features/sidebar/thread-search";
import { usePutOffRelayUpdate } from "../features/updates/put-off";
import type { PullsTarget } from "../features/pulls/pull-board";
import type { useSettingsPage } from "../features/settings/useSettingsPage";
import type { NavigationLock } from "../lib/navigation-lock";
import { useShortcutLabel } from "../lib/shortcuts";
import type { ShellNavigation, Surface } from "./useShellNavigation";
import type { SidebarVisibility } from "./useSidebarVisibility";
import "./activity-bar.css";

/** The sidebar's unread / needs-input dot. */
export type SidebarAttention = "waiting" | "unread";

/** What the sidebar's dot says, for a tooltip. */
export function sidebarDotSays(attention: SidebarAttention | undefined) {
  if (attention === "waiting") return "Needs your input";
  if (attention === "unread") return "New activity";
}

/** What the main pane shows, so the bar marks its button. */
type BarPage = "threads" | "inbox" | "usage" | "schedules" | "settings";

interface BarProps {
  nav: ShellNavigation;
  settings: ReturnType<typeof useSettingsPage>;
  sidebar: SidebarVisibility;
  lock: NavigationLock;
  /** Moves within the open Pull requests page, from a PR back to its board. */
  goToPulls: (target: PullsTarget) => void;
  onUsage: () => void;
  onSchedules: () => void;
  attention?: SidebarAttention;
}

function barPageFor(surface: Surface, settingsOpen: boolean): BarPage {
  if (settingsOpen) return "settings";
  return surface === "project" ? "threads" : surface;
}

/** Which button is lit, and where each button goes. */
function barNavigation(props: BarProps) {
  const { nav, settings, sidebar, lock, goToPulls, onUsage, onSchedules } =
    props;
  const page = barPageFor(nav.surface, settings.open);
  // Settings covers the page but not the bar, so the page's own button
  // uncovers it rather than moving it.
  const coveredBySettings = (surface: Surface) =>
    settings.open && nav.surface === surface;
  return {
    page,
    /** Back to the threads from a page or Settings; on them already, the sidebar folds. */
    showThreads() {
      if (page === "threads") return sidebar.toggle();
      if (lock.blocked()) return;
      settings.close();
      nav.setSurface("project");
    },
    /** From the page itself back to its board; from anywhere else to where it was left. */
    openPulls() {
      if (coveredBySettings("inbox")) return settings.close();
      if (lock.blocked()) return;
      if (nav.inbox) goToPulls({ to: "board" });
      else nav.setInbox(true);
    },
    toggleUsage() {
      if (coveredBySettings("usage")) settings.close();
      else onUsage();
    },
    toggleSchedules() {
      if (coveredBySettings("schedules")) settings.close();
      else onSchedules();
    },
    toggleSettings() {
      if (settings.open) settings.close();
      else settings.show();
    },
  };
}

/**
 * The window's left edge: the threads, thread search and the pages that open
 * in place of a project, with Settings alone at the bottom under a line.
 */
export function ActivityBar(props: BarProps) {
  const { nav, settings, sidebar } = props;
  const bar = barNavigation(props);
  const { page } = bar;
  // Time spent on Pull requests, Usage or Schedules isn't the project's.
  const tracked = nav.surface === "project" ? nav : undefined;
  const searchKeys = useShortcutLabel("search-threads");
  const settingsKeys = useShortcutLabel("settings");
  const putOffUpdate = usePutOffRelayUpdate();
  const away = sidebar.barFolded && !sidebar.peek;
  return (
    <nav
      ref={sidebar.barRef}
      className={`activity-bar ${sidebar.barFolded ? "folded" : ""} ${sidebar.peek ? "peek" : ""}`}
      aria-label="Activity bar"
      aria-hidden={away || undefined}
      inert={away || undefined}
      onMouseEnter={sidebar.barFolded ? sidebar.peekOpen : undefined}
      onMouseLeave={sidebar.barFolded ? sidebar.peekClose : undefined}
    >
      <ThreadsButton
        onThreads={page === "threads"}
        sidebarHidden={sidebar.hidden}
        attention={props.attention}
        onClick={bar.showThreads}
      />
      <BarButton
        label="Search threads"
        keys={searchKeys}
        onClick={openThreadSearch}
      >
        <Search size={19} />
      </BarButton>
      <BarButton
        label="Pull requests"
        current={page === "inbox"}
        onClick={bar.openPulls}
      >
        <GitPullRequest size={19} />
      </BarButton>
      <BarButton
        label="Schedules"
        current={page === "schedules"}
        onClick={bar.toggleSchedules}
      >
        <ScheduledThreadIcon size={19} />
      </BarButton>
      <span className="activity-bar-fill" />
      <ClockifyTimer
        projectId={tracked?.project?.id}
        projectName={tracked?.project?.name}
        chatId={tracked?.chat?.id}
        onSetUp={() => settings.show("integrations")}
      />
      <BarButton
        label="Usage"
        current={page === "usage"}
        onClick={bar.toggleUsage}
      >
        <ChartColumn size={19} />
      </BarButton>
      <span className="activity-bar-line" aria-hidden="true" />
      <BarButton
        label="Open settings"
        keys={settingsKeys}
        dot={putOffUpdate}
        current={page === "settings"}
        onClick={bar.toggleSettings}
      >
        <Settings2 size={19} />
      </BarButton>
    </nav>
  );
}

/** Threads carries the sidebar's dot while the sidebar is hidden. */
function ThreadsButton({
  onThreads,
  sidebarHidden,
  attention,
  onClick,
}: {
  onThreads: boolean;
  sidebarHidden: boolean;
  attention?: SidebarAttention;
  onClick: () => void;
}) {
  return (
    <BarButton
      label="Threads"
      dot={sidebarHidden ? sidebarDotSays(attention) : undefined}
      status={attention}
      current={onThreads}
      onClick={onClick}
    >
      <MessagesSquare size={19} />
    </BarButton>
  );
}

function BarButton({
  label,
  keys = "",
  dot,
  status,
  current = false,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  /** Something waiting there, which the dot marks and the tooltip names. */
  dot?: string;
  /** The dot in the sidebar's own look, for the sidebar's news. */
  status?: SidebarAttention;
  current?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`activity-bar-button ${current ? "active" : ""}`}
      aria-label={dot ? `${label} · ${dot}` : label}
      aria-current={current ? "page" : undefined}
      title={[`${label}  ${keys}`.trim(), dot].filter(Boolean).join(" · ")}
      onClick={onClick}
    >
      {children}
      {dot &&
        (status ? (
          <span
            className={`sb-status ${status} activity-bar-status`}
            aria-hidden="true"
          >
            <i />
          </span>
        ) : (
          <span className="activity-bar-dot" aria-hidden="true" />
        ))}
    </button>
  );
}

/** A clock with a thread bubble: a thread that starts on a schedule. */
function ScheduledThreadIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a9 9 0 1 0-9 9" />
      <path d="M11 6v5h3.5" />
      <path d="M22 15a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v7l2.5-2H21a1 1 0 0 0 1-1z" />
    </svg>
  );
}
