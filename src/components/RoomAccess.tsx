import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import type { Pull } from "../../shared/types";
import { parseRoomInvitation } from "../../shared/rooms";
import { api } from "../lib/api";
import type { SettingsCategory } from "./Settings";
import { ErrorBox } from "./ui";

/** A PR without a room yet: invite a colleague, or join with their link. */
export function RoomConnect({
  pull,
  onConnected,
  onInvited,
  onSettings,
}: {
  pull: Pull;
  onConnected: () => void;
  onInvited: (code: string) => Promise<void>;
  onSettings: (category?: SettingsCategory) => void;
}) {
  const access = useQuery({
    queryKey: ["room-access-info", pull.owner, pull.name],
    queryFn: () => api.roomAccessInfo(pull),
  });
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <div className="room-connect">
      <div className="room-empty-icon">
        <Users size={27} />
      </div>
      <h2>Review it together.</h2>
      <p>
        Create a link for this pull request.
        <br />
        Your colleague opens it in Relay.
      </p>
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(undefined);
          void (async () => {
            if (!access.data?.server)
              throw new Error("Configure room hosting in Settings first.");
            if (!(await api.folder(pull))) await api.linkFolder(pull);
            await api.allowRoomAccess(pull, access.data.server);
            return api.roomInvite(pull);
          })()
            .then((i) => onInvited(i.code))
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        <Users size={16} />
        {busy ? "Creating invitation…" : "Invite colleague"}
      </button>
      <p className="field-note">
        A private conversation beside the code. Everyone uses their own Gitea
        login and agent account. The room server{" "}
        {access.data?.server ?? "configured in Settings"} receives your Gitea
        token over HTTPS for a repository access check and does not store it. A
        matching local clone is required.
      </p>
      <details>
        <summary>Have an invitation link?</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError(undefined);
            void (async () => {
              const { server, secret, projectId } = parseRoomInvitation(invite);
              if (!(await api.folder(pull))) await api.linkFolder(pull);
              await api.allowRoomAccess(pull, server);
              await api.roomConnect(pull, { server, secret, projectId });
              onConnected();
            })()
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Project invitation
            <textarea
              rows={3}
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              autoComplete="off"
              placeholder="Paste an invitation link"
            />
          </label>
          <button disabled={busy || !invite.trim()}>Join project room</button>
        </form>
      </details>
      {!!error && <ErrorBox error={error} />}
      <button className="subtle" onClick={() => onSettings("rooms")}>
        Hosting settings
      </button>
    </div>
  );
}

/** The room's history needs Gitea access checked again, or a fresh connection. */
export function RoomAccessPrompt({
  pull,
  onReady,
}: {
  pull: Pull;
  onReady: () => void;
}) {
  const info = useQuery({
    queryKey: ["room-access-info", pull.owner, pull.name],
    queryFn: () => api.roomAccessInfo(pull),
  });
  const [error, setError] = useState<unknown>();
  return (
    <div className="room-connect">
      <p>
        Verify Gitea access and link the matching clone before reopening shared
        history.
      </p>
      <p className="field-note">
        {info.data?.server} receives your Gitea token over HTTPS for this check,
        without storing it.
      </p>
      <button
        disabled={!info.data?.server}
        onClick={() =>
          void (async () => {
            if (!(await api.folder(pull))) await api.linkFolder(pull);
            await api.allowRoomAccess(pull, info.data!.server!);
            onReady();
          })().catch(setError)
        }
      >
        Verify shared access
      </button>
      <button
        onClick={() =>
          void api.roomDisconnect(pull).then(onReady).catch(setError)
        }
      >
        Reconnect project
      </button>
      {!!error && <ErrorBox error={error} />}
    </div>
  );
}
