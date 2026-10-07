import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
} from "../../ui/SettingsCard";

export function RoomHostingSettings() {
  const qc = useQueryClient();
  const changed = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        ["roomHosting", "room-access-info"].includes(String(q.queryKey[0])),
    });
  const hosting = useQuery({
    queryKey: ["roomHosting"],
    queryFn: () => api.roomHosting(),
  });
  const [server, setServer] = useState<string>();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const url = server ?? hosting.data?.server ?? "";
  return (
    <>
      <SettingsCard>
        <SettingsRow
          label={hosting.data?.server ? "Hosting ready" : "No hosting set up"}
          hint={
            hosting.data?.server
              ? `Invitations you create use ${hosting.data.server}.`
              : "Opening a colleague’s invitation needs no setup. To host your own rooms, authorize your server once."
          }
        />
        <details>
          <summary>Manage hosting access</summary>
          <SettingsRow label="Room server">
            <input
              aria-label="Room server"
              placeholder="https://rooms.example.com"
              value={url}
              onChange={(e) => setServer(e.target.value)}
            />
          </SettingsRow>
          <SettingsRow
            label="Server setup key"
            hint="For the server owner. Never included in invitations."
          >
            <input
              aria-label="Server setup key"
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </SettingsRow>
          <SettingsFooter note="Saved with your system’s credential protection.">
            {hosting.data?.server && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api
                    .saveRoomHosting(null)
                    .then(changed)
                    .catch(setError)
                    .finally(() => setBusy(false));
                }}
              >
                Forget hosting access
              </button>
            )}
            <button
              className="primary"
              disabled={busy || !url.trim() || !secret.trim()}
              onClick={() => {
                setBusy(true);
                setError(undefined);
                void api
                  .saveRoomHosting({
                    server: url.trim(),
                    secret: secret.trim(),
                  })
                  .then(() => {
                    setSecret("");
                    return changed();
                  })
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Saving…" : "Save hosting access"}
            </button>
          </SettingsFooter>
        </details>
      </SettingsCard>
      {!!(error || hosting.error) && (
        <ErrorBox error={error || hosting.error} />
      )}
    </>
  );
}
