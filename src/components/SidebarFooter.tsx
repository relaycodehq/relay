import { Settings2 } from "lucide-react";
import { AgentUpdateButton } from "./AgentUpdates";
import { ClockifyTimer } from "./plugins/ClockifyTimer";
import type { SettingsCategory } from "./Settings";
import { IconButton } from "./ui";
import { CheckUpdatesButton, UpdateButton } from "./UpdateButton";

/** The account, the time tracker, updates and Settings, under the sidebar. */
export function SidebarFooter({
  account,
  projectId,
  projectName,
  chatId,
  onAccount,
  onSettings,
}: {
  account: string | undefined;
  projectId: string | undefined;
  projectName: string | undefined;
  chatId: string | undefined;
  onAccount: () => void;
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
      <ClockifyTimer
        projectId={projectId}
        projectName={projectName}
        chatId={chatId}
        onSetUp={() => onSettings("plugins")}
      />
      <UpdateButton />
      <CheckUpdatesButton />
      <AgentUpdateButton onDetails={() => onSettings("models")} />
      <IconButton label="Open settings" onClick={() => onSettings()}>
        <Settings2 size={15} />
      </IconButton>
    </div>
  );
}
