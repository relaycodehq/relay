import { useRef } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  CalendarSync,
  ChartColumn,
  Cpu,
  Ellipsis,
  GitPullRequest,
  Settings2,
} from "lucide-react";
import { DevRestartButton } from "../updates/DevRestartButton";
import { DevCheckoutLabel } from "./DevSwitchMenu";
import { ClockifyTimer } from "../plugins/ClockifyTimer";
import type { SettingsCategory } from "../settings/Settings";
import { IconButton } from "../../ui/ui";
import { RunningVersion } from "../updates/RunningVersion";
import { UpdateToasts } from "../updates/UpdateToasts";
import { useFooterFit } from "./useFooterFit";
import { MenuAction, MenuPopup } from "./SidebarMenu";

/**
 * The version, the time tracker and global navigation under both sidebar views,
 * with Relay's and the agents' updates rising above them.
 */
export function SidebarFooter({
  projectId,
  projectName,
  chatId,
  inbox,
  onInbox,
  usage,
  onUsage,
  processes,
  onProcesses,
  schedules,
  onSchedules,
  onSettings,
}: {
  projectId: string | undefined;
  projectName: string | undefined;
  chatId: string | undefined;
  /** Whether the Pull requests page is showing. */
  inbox?: boolean;
  onInbox: () => void;
  /** Whether the Usage page is showing. */
  usage?: boolean;
  onUsage?: () => void;
  /** Whether the Processes page is showing. */
  processes?: boolean;
  onProcesses?: () => void;
  /** Whether the Schedules page is showing. */
  schedules?: boolean;
  onSchedules?: () => void;
  /** Opens Settings, at `category` when given. */
  onSettings: (category?: SettingsCategory) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  useFooterFit(row);
  return (
    <div className="sb-footer-area">
      <UpdateToasts onAgentDetails={() => onSettings("agents")} />
      <div className="sb-footer" ref={row}>
        <RunningVersion onAbout={() => onSettings("about")} />
        <DevCheckoutLabel />
        <DevRestartButton />
        <ClockifyTimer
          projectId={projectId}
          projectName={projectName}
          chatId={chatId}
          onSetUp={() => onSettings("integrations")}
        />
        <button
          type="button"
          className={`icon-button ${inbox ? "active" : ""}`}
          title="Pull requests"
          aria-label="Pull requests"
          aria-current={inbox ? "page" : undefined}
          onClick={onInbox}
        >
          <GitPullRequest size={15} />
        </button>
        <IconButton label="Open settings" onClick={() => onSettings()}>
          <Settings2 size={15} />
        </IconButton>
        <span className="sb-footer-separator" aria-hidden="true" />
        <Menu.Root>
          <Menu.Trigger
            className={`icon-button sb-footer-more ${usage || processes || schedules ? "active" : ""}`}
            aria-label="More tools"
            title="More tools"
          >
            <Ellipsis size={15} />
          </Menu.Trigger>
          <MenuPopup side="top" align="end" sideOffset={8}>
            <MenuAction
              icon={<ChartColumn size={15} />}
              aria-current={usage ? "page" : undefined}
              disabled={!onUsage}
              onClick={onUsage}
            >
              Usage
            </MenuAction>
            <MenuAction
              icon={<Cpu size={15} />}
              aria-current={processes ? "page" : undefined}
              disabled={!onProcesses}
              onClick={onProcesses}
            >
              Processes
            </MenuAction>
            <MenuAction
              icon={<CalendarSync size={15} />}
              aria-current={schedules ? "page" : undefined}
              disabled={!onSchedules}
              onClick={onSchedules}
            >
              Schedules
            </MenuAction>
          </MenuPopup>
        </Menu.Root>
      </div>
    </div>
  );
}
