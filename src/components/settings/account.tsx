import { LogIn, LogOut } from "lucide-react";
import type { Account } from "../../../shared/types";
import type { SettingEntry } from "../../lib/settings-search";
import { Avatar } from "../ui";

export function accountEntries({
  account,
  onConnect,
  onDisconnect,
  setError,
}: {
  account: Account | null;
  onConnect?: () => void;
  onDisconnect: () => Promise<void>;
  setError: (error: unknown) => void;
}): SettingEntry[] {
  return [
    {
      id: "gitea",
      category: "account",
      title: "Gitea account",
      description: account
        ? account.server
        : "Connect to review pull requests and link projects to their remote.",
      keywords: "sign in login token server connect",
      render: () =>
        account ? (
          <div className="settings-account">
            <Avatar name={account.user.login} />
            <strong>{account.user.login}</strong>
          </div>
        ) : onConnect ? (
          <button className="primary" onClick={onConnect}>
            <LogIn size={14} />
            Connect Gitea
          </button>
        ) : (
          <span className="setting-muted">Not connected</span>
        ),
    },
    ...(account
      ? [
          {
            id: "credentials",
            category: "account" as const,
            title: "Credential storage",
            description: account.persistent
              ? "Your token is encrypted using the operating system’s credential protection."
              : "Your token is kept for this session only because secure credential storage is unavailable.",
            keywords: "keychain token secure encryption",
            render: () => (
              <span className="setting-pill">
                {account.persistent ? "Encrypted" : "Session only"}
              </span>
            ),
          },
          {
            id: "disconnect",
            category: "account" as const,
            title: "Disconnect account",
            description:
              "Local drafts, read marks, and folder links are preserved for this account.",
            keywords: "sign out logout remove",
            render: () => (
              <button
                className="danger subtle"
                onClick={() => void onDisconnect().catch(setError)}
              >
                <LogOut size={14} />
                Disconnect account
              </button>
            ),
          },
        ]
      : []),
  ];
}
