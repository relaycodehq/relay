import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorBox } from "./ui";

export function RoomHostingSettings() {
  const qc = useQueryClient();
  const changed = () =>
    qc.invalidateQueries({
      predicate: (q) =>
        ["roomHosting", "room-access-info", "chat-share-info"].includes(
          String(q.queryKey[0]),
        ),
    });
  const hosting = useQuery({
    queryKey: ["roomHosting"],
    queryFn: () => api.roomHosting(),
  });
  const [server, setServer] = useState<string>();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <section className="ai-settings">
      <h3>Shared rooms</h3>
      <p className="field-note">
        {hosting.data?.server
          ? `Ready to create invitations using ${hosting.data.server}.`
          : "Opening a colleague’s invitation needs no server setup. To host your own rooms, authorize your server once below."}
      </p>
      <details>
        <summary>Manage hosting access</summary>
        <label>
          Room server
          <input
            aria-label="Room server"
            value={
              server ?? hosting.data?.server ?? "https://example.com/review-relay"
            }
            onChange={(e) => setServer(e.target.value)}
          />
        </label>
        <label>
          Server setup key
          <input
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <p className="field-note">
          For the server owner. Saved with your operating system’s credential
          protection; never included in invitations.
        </p>
        <button
          disabled={busy || !secret.trim()}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            void api
              .saveRoomHosting({
                server:
                  server ??
                  hosting.data?.server ??
                  "https://example.com/review-relay",
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
      </details>
      {!!(error || hosting.error) && (
        <ErrorBox error={error || hosting.error} />
      )}
    </section>
  );
}
