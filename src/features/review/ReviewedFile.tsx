import { CheckCheck, ChevronRight } from "lucide-react";

/** Stands in for a viewed file's diff until it's expanded. */
export function ReviewedFile({
  path,
  allViewed,
  last,
  onExpand,
  onNext,
}: {
  path: string;
  allViewed: boolean;
  /** No file follows it. */
  last: boolean;
  onExpand: () => void;
  onNext: () => void;
}) {
  return (
    <div className="empty reviewed-empty">
      <span className="reviewed-icon">
        <CheckCheck size={28} />
      </span>
      <h2>{allViewed ? "All files reviewed." : "One file closer."}</h2>
      <p>
        <strong>{path.split("/").pop()}</strong> is marked as read.
        <br />
        Your place is saved for this revision.
      </p>
      <div>
        <button onClick={onExpand}>Expand file</button>
        <button className="primary" disabled={last} onClick={onNext}>
          Next file <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
}
function ArrowRightIcon() {
  return <ChevronRight size={15} />;
}
