import { memo, useState, type ReactNode } from "react";
import { clock } from "../../../shared/waiting";
import { agentName } from "../../../shared/agents";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import type { ChatMessage } from "../../../shared/projects";
import { CompactionRow } from "./CompactionRow";
import { SessionReloadRow } from "./SessionReloadRow";
import { WorktreeCommandRow } from "./WorktreeCommandRow";
import {
  AssistantMessage,
  type AssistantMessageProps,
} from "./AssistantMessage";
import { UserMessage, type UserMessageProps } from "./UserMessage";
import { RichText } from "../../ui/RichText";
import { LineDivider } from "../../ui/LineDivider";
import "./thread.css";
/** One-line divider where another agent took over, with the outgoing agent's note behind it. */
function HandoffRow({
  message: m,
  projectRoot,
  onOpenFile,
  unread,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
  unread?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { from, to, computer, byRelay } = m.handoff!;
  const switched = computer
    ? `Continued on ${computer} · ${clock(m.created)}`
    : `Switched from ${agentName(from)} to ${agentName(to)}${byRelay ? ` · ${agentName(from)} couldn't write a note, Relay did` : ""}`;
  const note = m.status === "complete" && m.body.trim();
  return (
    <div
      className="agent-handoff"
      data-message-id={m.id}
      data-status={m.status}
      role="status"
    >
      <LineDivider>
        {unread}
        <span>
          {m.status === "streaming"
            ? `${agentName(from)} is writing a handoff note for ${computer ?? agentName(to)}…`
            : note
              ? switched
              : `${switched} · no handoff note`}
        </span>
        {note && (
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide note" : "Show note"}
          </button>
        )}
      </LineDivider>
      {note && open && (
        <div className="agent-handoff-note">
          <RichText
            text={m.body}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
          />
        </div>
      )}
    </div>
  );
}
/** Message shows `m` as a one-line divider rather than a message. */
export const drawsLine = (m: ChatMessage) =>
  !m.handedOver &&
  !!(m.resumed || m.handoff || m.reload || m.worktreeCommand || m.compaction);

/** A message in the thread, or the one-line divider it stands for. */
export const Message = memo(function Message({
  unread,
  onRerunSetup,
  ...props
}: AssistantMessageProps &
  UserMessageProps & {
    /** Offered on the thread's latest worktree setup, when it didn't get through. */
    onRerunSetup?: (m: ChatMessage) => Promise<void>;
    /** The unread mark, on a row that draws its own line (see drawsLine) instead of a divider stacking against it. */
    unread?: ReactNode;
  }) {
  const { message: m, projectRoot, onOpenFile } = props;
  if (m.handedOver) return null;
  if (m.resumed)
    return (
      <LineDivider
        className="resume-divider"
        data-message-id={m.id}
        role="separator"
        aria-label={`Resumed at ${clock(m.created)}`}
      >
        {unread}
        <span>
          Resumed ·{" "}
          <time dateTime={new Date(m.created).toISOString()}>
            {clock(m.created)}
          </time>
        </span>
      </LineDivider>
    );
  if (m.role === "user" && (m.asyncQuestionAnswer || m.pageAnswer)) return null;
  if (m.handoff)
    return (
      <HandoffRow
        message={m}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
        unread={unread}
      />
    );
  if (m.reload)
    return <SessionReloadRow message={m} reload={m.reload} unread={unread} />;
  if (m.worktreeCommand)
    return (
      <WorktreeCommandRow
        message={m}
        onRerun={onRerunSetup && (() => onRerunSetup(m))}
        unread={unread}
      />
    );
  if (m.compaction)
    return (
      <CompactionRow
        message={m}
        projectRoot={projectRoot}
        onOpenFile={onOpenFile}
        unread={unread}
      />
    );
  return m.role === "user" ? (
    <UserMessage {...props} />
  ) : (
    <AssistantMessage {...props} />
  );
});
