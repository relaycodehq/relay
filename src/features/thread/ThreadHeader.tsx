import { ArrowLeft } from "lucide-react";
import {
  useStartedThreads,
  type StartedThreadsView,
} from "../agent-turn/StartedThreads";

/**
 * The strip above a side conversation, a deep review's reviewer or a second
 * opinion, with the way back out of it.
 */
export function ThreadHeader({
  chatId,
  onLeaveReply,
  onBackToReview,
}: {
  chatId: string | undefined;
  /** Set while a side conversation is open. */
  onLeaveReply?: () => void;
  onBackToReview?: () => void;
}) {
  const view = useStartedThreads();
  if (onLeaveReply)
    return <BackButton onBack={onLeaveReply} label="Back to conversation" />;
  if (onBackToReview)
    return <BackButton onBack={onBackToReview} label="Back to review" />;
  const checked = view && secondOpinionChecks(view, chatId);
  if (!checked) return null;
  return (
    <BackButton
      onBack={() => view.open(checked)}
      label="Back to conversation"
    />
  );
}

/** The thread whose answer this second opinion checks, while it's listed. */
function secondOpinionChecks(view: StartedThreadsView, chatId?: string) {
  const thread = view.threads.find((c) => c.id === chatId);
  if (!thread?.startedBy?.secondOpinionOn) return undefined;
  return view.threads.find((c) => c.id === thread.startedBy!.chatId);
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="thread-subheader">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={14} />
        {label}
      </button>
    </div>
  );
}
