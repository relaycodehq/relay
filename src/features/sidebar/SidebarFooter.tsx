import { ChartColumn, Settings2 } from "lucide-react";
import { AgentUpdateButton } from "../updates/AgentUpdates";
import { ClockifyTimer } from "../plugins/ClockifyTimer";
import type { SettingsCategory } from "../settings/Settings";
import { IconButton } from "../../ui/ui";
import { CheckUpdatesButton, UpdateButton } from "../updates/UpdateButton";

/** The account, the time tracker, updates, Usage and Settings, under the sidebar. */
export function SidebarFooter({
  account,
  projectId,
  projectName,
  chatId,
  usage,
  onAccount,
  onUsage,
  onSettings,
}: {
  account: string | undefined;
  projectId: string | undefined;
  projectName: string | undefined;
  chatId: string | undefined;
  /** Whether the Usage page is showing. */
  usage?: boolean;
  onAccount: () => void;
  // Here as well as in the Projects nav, since Activity hides that nav.
  onUsage?: () => void;
  /** Opens Settings, at `category` when given. */
  onSettings: (category?: SettingsCategory) => void;
}) {
  return (
    <div className="sb-footer">
      <button
        className={`sb-account ${account ? "signed-in" : ""}`}
        title={account}
        aria-label={account}
        onClick={onAccount}
      >
        <span className="sb-avatar" aria-hidden>
          {(account ?? "?").slice(0, 2).toUpperCase()}
        </span>
        {!account && <span>Connect Gitea</span>}
      </button>
      <UpdateButton />
      <CheckUpdatesButton />
      <AgentUpdateButton onDetails={() => onSettings("models")} />
      <ClockifyTimer
        projectId={projectId}
        projectName={projectName}
        chatId={chatId}
        onSetUp={() => onSettings("plugins")}
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
