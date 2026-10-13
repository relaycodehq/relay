import { useRef } from "react";
import { ChartColumn, Settings2 } from "lucide-react";
import { AgentUpdateButton } from "../updates/AgentUpdates";
import { DevRestartButton } from "../updates/DevRestartButton";
import { DevCheckoutLabel } from "./DevSwitchMenu";
import { ClockifyTimer } from "../plugins/ClockifyTimer";
import type { SettingsCategory } from "../settings/Settings";
import { IconButton } from "../../ui/ui";
import { RunningVersion, UpdateButton } from "../updates/UpdateButton";
import { useFooterFit } from "./useFooterFit";

/** The version, the time tracker, updates, Usage and Settings, under the sidebar. */
export function SidebarFooter({
  projectId,
  projectName,
  chatId,
  usage,
  onUsage,
  onSettings,
}: {
  projectId: string | undefined;
  projectName: string | undefined;
  chatId: string | undefined;
  /** Whether the Usage page is showing. */
  usage?: boolean;
  // Here as well as in the Projects nav, since Activity hides that nav.
  onUsage?: () => void;
  /** Opens Settings, at `category` when given. */
  onSettings: (category?: SettingsCategory) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  useFooterFit(row);
  return (
    <div className="sb-footer" ref={row}>
      <RunningVersion onAbout={() => onSettings("about")} />
      <DevCheckoutLabel />
      <DevRestartButton />
      <UpdateButton />
      <AgentUpdateButton onDetails={() => onSettings("agents")} />
      <ClockifyTimer
        projectId={projectId}
        projectName={projectName}
        chatId={chatId}
        onSetUp={() => onSettings("integrations")}
      />
      <IconButton label="Usage" active={usage} onClick={onUsage}>
        <ChartColumn size={15} />
      </IconButton>
      <IconButton label="Open settings" onClick={() => onSettings()}>
        <Settings2 size={15} />
      </IconButton>
    </div>
  );
}
