import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import type { Pull } from "../../../shared/types";
import type { RoomState } from "../../../shared/rooms";
import { api } from "../../lib/api";
import { keys } from "../../lib/mod-key";
import { RoomAvatar } from "./RoomTranscript";
import { ErrorBox, Modal } from "../../ui/ui";

/** Who's in the room's project, inviting more of them, and leaving it. */
export function RoomPeople({
  initialInvite,
  pull,
  state,
  onClose,
  onDisconnect,
}: {
  pull: Pull;
  state: RoomState;
  initialInvite: string;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const [invite, setInvite] = useState(initialInvite),
    [copied, setCopied] = useState(false),
    [error, setError] = useState<unknown>();
  const members = useQuery({
    queryKey: ["roomMembers", state.connection?.projectId],
    queryFn: () => api.roomMembers(pull),
  });
  return (
    <Modal title="People in this project" onClose={onClose}>
      <p className="muted">
        Invitations share this project’s PR rooms and their conversation
        history. Each person links their own repository folder and agent
        account.
      </p>
      <div className="room-member-list">
        {members.data?.map((m) => (
          <div key={m.id}>
            <RoomAvatar name={m.name} />
            <span>
              <strong>{m.name}</strong>
              <small>
                {m.owner ? "Project owner" : "Participant"} · {m.id.slice(0, 8)}
              </small>
            </span>
            {state.connection?.member.owner && !m.owner && (
              <button
                onClick={() => {
                  void api
                    .roomRevoke(pull, m.id)
                    .then(() => members.refetch())
                    .catch(setError);
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="muted">
        Membership is tied to a verified Gitea account with repository access.
        Display names come from Gitea.
      </p>
      {state.connection?.member.owner && (
        <>
          <button
            onClick={() => {
              void api
                .roomInvite(pull)
                .then((i) => {
                  setInvite(i.code);
                  setCopied(false);
                })
                .catch(setError);
            }}
          >
            {invite ? "Generate another link" : "Invite colleague"}
          </button>
          {invite && (
            <label>
              Invitation link
              <input
                aria-label="Invitation link"
                readOnly
                value={invite}
                onFocus={(e) => e.currentTarget.select()}
              />
              <small>
                Expires after 24 hours. Share directly with your colleague.
              </small>
              <button
                onClick={() => {
                  void api
                    .writeClipboard(invite)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError(
                        new Error(
                          `Select the invitation link and copy it with ${keys("⌘C", "Ctrl+C")}.`,
                        ),
                      ),
                    );
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                {copied ? "Copied" : "Copy invitation"}
              </button>
            </label>
          )}
        </>
      )}
      {!!(error || members.error) && (
        <ErrorBox error={error || members.error} />
      )}
      <div className="modal-actions">
        <button onClick={onDisconnect}>Disconnect this device</button>
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
