import { useState } from "react";
import { ArrowLeft, LockKeyhole, Users } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import type { ChatPresence } from "./useChatPresence";
import { LiveSyncControls } from "../changes/LiveSyncControls";

/** The strip above a thread: who it's shared with, sharing it, and the way
 * back out of a side conversation. */
export function ThreadHeader({
  chat,
  plain,
  presence: { peers, sharePresence, setSharePresence },
  screenshots,
  onShare,
  onBack,
}: {
  chat?: ChatSummary;
  /** A folder without Git, which isn't offered sharing. */
  plain?: boolean;
  presence: ChatPresence;
  /** Whether a message carries screenshots, which keep a private thread private. */
  screenshots: boolean;
  onShare: () => void;
  /** Given while a side conversation is open. */
  onBack?: () => void;
}) {
  const [sharingOpen, setSharingOpen] = useState(false);
  return (
    <>
      <div className="thread-subheader">
        {onBack ? (
          <button className="text-button" onClick={onBack}>
            <ArrowLeft size={14} />
            Back to conversation
          </button>
        ) : (
          <span className="thread-privacy">
            {chat?.shared ? <Users size={13} /> : <LockKeyhole size={13} />}{" "}
            {chat?.shared ? "Shared with your project" : "Private thread"}
          </span>
        )}
        <span className="spacer" />
        {chat?.shared && (
          <button
            className="text-button"
            onClick={() => setSharingOpen((v) => !v)}
            aria-expanded={sharingOpen}
          >
            Together{peers.length ? ` · ${peers.length + 1}` : ""}
          </button>
        )}
        {chat && !plain && (
          <button
            className="text-button"
            aria-label="Share conversation"
            onClick={onShare}
            disabled={
              (!chat.shared && screenshots) || chat.scope.kind === "review"
            }
            title={
              chat.scope.kind === "review"
                ? "Deep reviews can't be shared yet"
                : !chat.shared && screenshots
                  ? "This conversation contains private screenshots and cannot be shared yet"
                  : undefined
            }
          >
            <Users size={14} />
            {chat.shared ? "Invite" : "Share"}
          </button>
        )}
      </div>
      {chat?.shared && sharingOpen && (
        <div className="project-chat-sharing">
          <label>
            <input
              type="checkbox"
              checked={sharePresence}
              onChange={(e) => setSharePresence(e.target.checked)}
            />
            Share my location
          </label>
          <LiveSyncControls chatId={chat.id} />
        </div>
      )}
      {chat?.shared &&
        sharingOpen &&
        peers.map((p) => (
          <div className="chat-peer-presence" key={p.userId}>
            {p.name} · {p.path?.split("/").pop() ?? "In conversation"}
            {p.total ? ` · ${p.viewed}/${p.total} viewed` : ""}
          </div>
        ))}
    </>
  );
}
