import { useState } from "react";
import { parseRoomInvitation } from "../../shared/rooms";
import { normalizeServer } from "../../shared/validation";
import type { Account, PullRef } from "../../shared/types";
import { api } from "../lib/api";
import { ErrorBox, Modal } from "./ui";

export function RoomInvitationDialog({
  url,
  account,
  onJoined,
  onClose,
}: {
  url: string;
  account: Account;
  onJoined: (ref: PullRef) => void;
  onClose: () => void;
}) {
  const invitation = parseRoomInvitation(url);
  const [busy, setBusy] = useState(false),
    [linking, setLinking] = useState(false),
    [linked, setLinked] = useState(false),
    [error, setError] = useState<unknown>();
  const matching =
    invitation.project?.server === normalizeServer(account.server);
  return (
    <Modal title="Join the review" onClose={onClose}>
      <h3>
        {invitation.project?.owner}/{invitation.project?.name} · PR #
        {invitation.number}
      </h3>
      <p className="muted">
        Join as <strong>{account.user.full_name || account.user.login}</strong>.
        You’ll open this pull request and its shared conversation.
      </p>
      <p className="field-note">
        Hosted at {invitation.server}. Joining gives you access to this
        project’s room history. Shared messages, code excerpts and agent answers
        are visible to members and the server owner. Joining sends your Gitea
        token over HTTPS to this server to verify repository access; it is not
        stored there. A matching local clone is required.
      </p>
      {!matching && (
        <ErrorBox
          error={
            new Error(
              `This invitation uses ${invitation.project?.server}. Connect that Gitea account in Settings first.`,
            )
          }
        />
      )}
      <button
        disabled={busy || linking || !matching}
        onClick={async () => {
          setLinking(true);
          setError(undefined);
          try {
            const folder = await api.linkFolder({
              owner: invitation.project!.owner,
              name: invitation.project!.name,
            });
            if (folder) setLinked(true);
          } catch (e) {
            setError(e);
          } finally {
            setLinking(false);
          }
        }}
      >
        {linking
          ? "Linking folder…"
          : linked
            ? "Local clone linked"
            : "Link matching local clone"}
      </button>
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || linking || !matching}
          onClick={() => {
            setBusy(true);
            setError(undefined);
            void api
              .roomAcceptInvitation(url)
              .then((result) => onJoined(result.ref))
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Joining…" : "Join and open PR"}
        </button>
      </div>
    </Modal>
  );
}
