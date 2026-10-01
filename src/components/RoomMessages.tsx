import { ArrowDown, ArrowUpRight, Users } from "lucide-react";
import type { RoomMessage } from "../../shared/rooms";
import type { Pull } from "../../shared/types";
import type { RoomFeed } from "../lib/useRoomFeed";
import { RoomTranscript } from "./RoomTranscript";

/** The room's shared conversation, with earlier pages on request. */
export function RoomMessages({
  pull,
  feed,
  memberId,
  onLoadEarlier,
  onInvite,
  onSelect,
  onReply,
  onCancel,
  onRetry,
}: {
  pull: Pull;
  feed: RoomFeed;
  memberId: string;
  onLoadEarlier: () => void;
  onInvite: () => void;
  onSelect: (path: string) => void;
  onReply: (m: RoomMessage) => void;
  onCancel: (id: string) => void;
  onRetry: (m: RoomMessage) => void;
}) {
  return (
    <>
      <div
        className="room-messages"
        ref={feed.viewport}
        role="log"
        aria-label="Shared conversation"
        aria-live="off"
        onScroll={feed.onScroll}
      >
        {feed.more && (
          <button className="room-load" onClick={onLoadEarlier}>
            Load earlier messages
          </button>
        )}
        {!feed.messages.length && (
          <div className="room-empty">
            <span className="room-empty-icon">
              <Users size={26} />
            </span>
            <h3>A second pair of eyes.</h3>
            <p>
              Talk through this PR with your colleague.
              <br />
              Mention <code>@codex</code> to ask your agent.
            </p>
            <button onClick={onInvite}>
              Invite a colleague <ArrowUpRight size={14} />
            </button>
            <small>
              Messages here stay in this room.
              <br />
              Gitea review comments are separate.
            </small>
          </div>
        )}
        <RoomTranscript
          messages={feed.messages}
          head={pull.head.sha}
          memberId={memberId}
          onSelect={onSelect}
          onReply={onReply}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      </div>
      {feed.newMessages && (
        <button className="room-new" onClick={feed.jumpToLatest}>
          New activity <ArrowDown size={12} />
        </button>
      )}
    </>
  );
}
