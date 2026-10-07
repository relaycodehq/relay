import { ArrowLeft } from "lucide-react";

/** The strip above a side conversation, with the way back out of it. */
export function ThreadHeader({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null;
  return (
    <div className="thread-subheader">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={14} />
        Back to conversation
      </button>
    </div>
  );
}
