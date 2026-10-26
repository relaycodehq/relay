import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import "./thread-frame.css";

/** A piece of another thread in a frame titled with it, which opens it. */
export function ThreadFrame({
  icon,
  title,
  status,
  failed,
  onOpen,
  aside,
  children,
}: {
  icon?: ReactNode;
  title: string;
  /** Where the thread stands, beside its title: "finished", "working". */
  status?: string;
  failed?: boolean;
  /** Absent where nothing can open it. */
  onOpen?: () => void;
  /** Beside the status, before Open: a small mark such as a spinner. */
  aside?: ReactNode;
  /** Absent for a frame that is only its header. */
  children?: ReactNode;
}) {
  return (
    <div className="thread-frame">
      <header>
        {icon}
        <b>{title}</b>
        {status && <span data-failed={failed ? "" : undefined}>{status}</span>}
        {aside}
        {onOpen && (
          <button type="button" className="thread-frame-open" onClick={onOpen}>
            Open <ArrowUpRight size={12} />
          </button>
        )}
      </header>
      {children}
    </div>
  );
}
