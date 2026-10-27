import type { Account } from "../../shared/types";
import { Settings } from "../features/settings/Settings";
import type { useSettingsPage } from "../features/settings/useSettingsPage";
import type { useSignIn } from "../features/settings/useSignIn";

/**
 * Settings in place of the page, wired to signing in and to opening a
 * thread from it.
 */
export function ShellSettings({
  settings,
  account,
  signIn,
  openChatById,
  onSignedOut,
}: {
  settings: ReturnType<typeof useSettingsPage>;
  account: Account | null | undefined;
  signIn: ReturnType<typeof useSignIn>;
  openChatById: (projectId: string, chatId: string, then?: () => void) => void;
  onSignedOut: () => void;
}) {
  return (
    <Settings
      account={account ?? null}
      initialCategory={settings.category}
      initialEntry={settings.entry}
      key={`${settings.project ?? "app"}:${settings.asked}`}
      projectId={settings.project}
      initialQuery={settings.query}
      onQueryChange={settings.setQuery}
      onWhere={settings.setWhere}
      onClose={settings.close}
      onConnect={() => {
        settings.close();
        void signIn.withAccount();
      }}
      onOpenChat={(projectId, chatId) =>
        openChatById(projectId, chatId, settings.close)
      }
      onDisconnect={async () => {
        await signIn.signOut();
        settings.close();
        onSignedOut();
      }}
    />
  );
}
