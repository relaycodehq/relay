import { ArrowLeft } from "lucide-react";

/**
 * The strip above a side conversation or a deep review's reviewer, with the
 * way back out of it.
 */
export function ThreadHeader({
  onBack,
  label = "Back to conversation",
}: {
  onBack?: () => void;
  label?: string;
}) {
  if (!onBack) return null;
  return (
    <div className="thread-subheader">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={14} />
        {label}
      </button>
    </div>
  );
}
