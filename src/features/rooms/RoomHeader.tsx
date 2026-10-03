import { ArrowUpRight, MessageSquare, Users, X } from "lucide-react";
import type { Presence, RoomState } from "../../../shared/rooms";
import type { Pull } from "../../../shared/types";
import { LiveSyncControls } from "../changes/LiveSyncControls";
import { RoomAvatar } from "./RoomTranscript";
import { IconButton } from "../../ui/ui";

type Connection = NonNullable<RoomState["connection"]>;

/** The room's title, who's in it, its connection and live sync. */
export function RoomHeader({
  pull,
  connection,
  others,
  networkError,
  showPresence,
  onTogglePresence,
  onPeople,
  onClose,
}: {
  pull: Pull;
  connection: Connection | null | undefined;
  /** Everyone in the room but you. */
  others: Presence[];
  networkError: boolean;
  showPresence: boolean;
  onTogglePresence: () => void;
  onPeople: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className="titlebar room-titlebar">
        <span className="room-thread-title" title={pull.title}>
          {pull.title}
        </span>
        <div className="room-header-actions">
          {connection && (
            <>
              <button
                className="room-avatars-button"
                aria-label="Review presence"
                title="Who's reviewing"
                aria-expanded={showPresence}
                onClick={onTogglePresence}
              >
                <span className="room-avatar-stack">
                  <RoomAvatar name={connection.member.name} />
                  {others.slice(0, 2).map((p) => (
                    <RoomAvatar key={p.userId} name={p.name} />
                  ))}
                </span>
              </button>
              <button
                className="room-share"
                aria-label="Room members and invitations"
                onClick={onPeople}
              >
                <Users size={13} />
                Share
              </button>
            </>
          )}
          <IconButton label="Hide PR room" onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
      </header>
      <div className="room-subheader">
        <span>
          <MessageSquare size={12} /> PR #{pull.number}{" "}
          <span className="room-subheader-divider">/</span> Conversation
        </span>
        {connection && (
          <button
            className="room-connection-status"
            onClick={onTogglePresence}
            aria-expanded={showPresence}
          >
            <span className={`dot ${networkError ? "" : "green"}`} />
            {networkError ? "Reconnecting…" : "Connected"}
          </button>
        )}
      </div>
      {connection && (
        <div className="room-sync-controls">
          <LiveSyncControls pull={pull} />
        </div>
      )}
    </>
  );
}

/** Who else is reviewing and where; choosing one opens their file. */
export function RoomPresence({
  pull,
  others,
  networkError,
  share,
  onShare,
  onSelect,
}: {
  pull: Pull;
  others: Presence[];
  networkError: boolean;
  share: boolean;
  onShare: (share: boolean) => void;
  onSelect: (path: string) => void;
}) {
  return (
    <div
      className="room-presence-popover"
      role="region"
      aria-label="Review presence"
    >
      <div className="room-presence">
        <span className={`dot ${networkError ? "" : "green"}`} />
        <span>
          {networkError
            ? "Reconnecting · your draft is kept"
            : others.length
              ? `${others.length} colleague online`
              : "Room connected"}
        </span>
        <label title="Share your current file and viewed count while this panel is open">
          <input
            type="checkbox"
            checked={share}
            onChange={(e) => onShare(e.target.checked)}
          />
          Share my place
        </label>
      </div>
      {others.map((p) => {
        const file = p.path?.split("/").at(-1) ?? "Reviewing";
        return (
          <button
            className="room-colleague"
            key={p.userId}
            disabled={!p.path || p.head !== pull.head.sha}
            onClick={() => p.path && onSelect(p.path)}
            title={p.path ?? "Reviewing this PR"}
          >
            <RoomAvatar name={p.name} />
            <span>
              <strong>{p.name}</strong>
              <small>
                {file} · {p.viewed}/{p.total} viewed
                {p.head !== pull.head.sha ? " · different revision" : ""}
              </small>
            </span>
            <ArrowUpRight size={14} />
          </button>
        );
      })}
    </div>
  );
}
