import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import type { Project, ChatSummary } from "../../../shared/projects";
import type { Account } from "../../../shared/types";
import { parseRoomInvitation } from "../../../shared/rooms";
import { api } from "../../lib/api";
import { ErrorBox, Loading, Modal } from "../../ui/ui";
import "./projects.css";
export function ShareConversation({
  chat,
  project,
  account,
  onClose,
  onSignIn,
  onShared,
}: {
  chat: ChatSummary;
  project: Project;
  account: Account | null;
  onClose: () => void;
  onSignIn: () => void;
  onShared: () => void;
}) {
  const info = useQuery({
    queryKey: ["chat-share-info", chat.id],
    queryFn: () => api.projectChatShareInfo(chat.id),
    enabled: !!account,
  });
  const [shared, setShared] = useState(!!chat.shared),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [link, setLink] = useState<string>();
  return (
    <Modal
      title={shared ? "Invite to conversation" : "Share conversation"}
      onClose={onClose}
    >
      <h3>{chat.title}</h3>
      <p>
        {shared
          ? "Invite a colleague with access to this repository."
          : `Share this conversation’s ${info.data?.messages ?? "saved"} messages, including code excerpts and completed agent answers.`}
      </p>
      {!shared && (
        <p className="field-note">
          Sharing sends messages and code excerpts already in this chat. It does
          not upload your working tree, uncommitted files or tool output. No
          commit is required. Saved-file sync is a separate opt-in.
        </p>
      )}
      <p className="field-note">
        Everyone must sign in to Gitea with access to{" "}
        {info.data?.project ?? project.name} and link a matching local clone. An
        invitation alone does not grant access.
      </p>
      {info.data?.server && (
        <p className="field-note">
          Hosted at <strong>{info.data.server}</strong>. To verify access, this
          server receives your Gitea token over HTTPS, uses it for the access
          check, and does not store it. Shared messages and files are readable
          by project members and the server owner. Agent credentials stay on
          your computer.
        </p>
      )}
      {info.error && <ErrorBox error={info.error} />}{" "}
      {!!error && <ErrorBox error={error} />}
      {link && (
        <label>
          Invitation link
          <input
            aria-label="Conversation invitation"
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button onClick={() => void api.writeClipboard(link).catch(setError)}>
            Copy invitation
          </button>
          <small>Expires in 24 hours. Each invitation can be used once.</small>
        </label>
      )}
      {!account ? (
        <button onClick={onSignIn}>Connect Gitea</button>
      ) : info.data && !info.data.server ? (
        <p className="field-note">
          Configure your room server in Settings, or join a colleague’s
          invitation first.
        </p>
      ) : (
        <div className="modal-actions">
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            disabled={busy || !info.data?.server}
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                if (!shared) {
                  await api.shareProjectChat(chat.id);
                  setShared(true);
                  onShared();
                }
                const invitation = await api.projectChatInvite(chat.id);
                setLink(invitation.url);
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Verifying access…"
              : shared
                ? "Create invitation"
                : "Verify access and share"}
          </button>
        </div>
      )}
    </Modal>
  );
}
export function JoinConversation({
  url,
  projects,
  account,
  onAdd,
  onSignIn,
  onClose,
  onJoined,
}: {
  url: string;
  projects: Project[];
  account: Account | null;
  onAdd: () => Promise<void>;
  onSignIn: () => void;
  onClose: () => void;
  onJoined: (projectId: string, chat: ChatSummary | null) => Promise<void>;
}) {
  const invitation = parseRoomInvitation(url);
  const matches = projects.filter(
    (p) =>
      p.repository &&
      p.repository.server === invitation.project?.server &&
      p.repository.owner === invitation.project?.owner &&
      p.repository.name === invitation.project?.name,
  );
  const [selection, setSelection] = useState(matches[0]?.id ?? ""),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const id = selection || matches[0]?.id;
  return (
    <Modal title="Join project conversation" onClose={onClose}>
      <h3>
        {invitation.project?.owner}/{invitation.project?.name}
      </h3>
      <p>Hosted at {invitation.server}.</p>
      <p className="field-note">
        Joining sends your Gitea token over HTTPS to this server for a
        repository access check. It is not stored there. Messages and shared
        files are visible to project members and the server owner.
      </p>
      {!account ? (
        <button onClick={onSignIn}>Connect Gitea</button>
      ) : !matches.length ? (
        <>
          <p>
            Link the matching local Git clone before joining. Your Gitea account
            must also have access.
          </p>
          <button onClick={() => void onAdd()}>
            Add matching project folder
          </button>
        </>
      ) : (
        <label>
          Local clone
          <select
            aria-label="Invitation project folder"
            value={id}
            onChange={(e) => setSelection(e.target.value)}
          >
            {matches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.path}
              </option>
            ))}
          </select>
        </label>
      )}
      {!!error && <ErrorBox error={error} />}
      <div className="modal-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || !id || !account}
          onClick={async () => {
            setBusy(true);
            try {
              const chat = await api.joinProjectConversation(id, url);
              await onJoined(id, chat);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Verifying…" : "Verify access and join"}
        </button>
      </div>
    </Modal>
  );
}
export function BrowseShared({
  project,
  onClose,
  onOpen,
}: {
  project: Project;
  onClose: () => void;
  onOpen: (chat: ChatSummary) => Promise<void>;
}) {
  const list = useQuery({
    queryKey: ["shared-chats", project.id],
    queryFn: () => api.sharedProjectChats(project.id),
  });
  const [error, setError] = useState<unknown>();
  return (
    <Modal title="Shared conversations" onClose={onClose}>
      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorBox error={list.error} />
      ) : list.data?.length ? (
        <div className="shared-chat-list">
          {list.data.map((chat) => (
            <button
              key={chat.id}
              onClick={() =>
                void api
                  .openSharedProjectChat(project.id, chat.id)
                  .then(onOpen)
                  .catch(setError)
              }
            >
              <MessageSquare size={16} />
              {chat.title}
            </button>
          ))}
        </div>
      ) : (
        <p>
          No shared conversations yet. Share a private chat, or open an
          invitation from your colleague.
        </p>
      )}
      {!!error && <ErrorBox error={error} />}
    </Modal>
  );
}
