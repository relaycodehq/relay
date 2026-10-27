import type { ReactNode } from "react";
import type { SidebarAttention } from "./ActivityBar";
import "./activity-bar.css";

/** One of the activity bar's icons, with the dot for what waits there. */
export function BarButton({
  label,
  keys = "",
  dot,
  status,
  current = false,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  /** Something waiting there, which the dot marks and the tooltip names. */
  dot?: string;
  /** The dot in the sidebar's own look, for the sidebar's news. */
  status?: SidebarAttention;
  current?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`activity-bar-button ${current ? "active" : ""}`}
      aria-label={dot ? `${label} · ${dot}` : label}
      aria-current={current ? "page" : undefined}
      title={[`${label}  ${keys}`.trim(), dot].filter(Boolean).join(" · ")}
      onClick={onClick}
    >
      {children}
      {dot &&
        (status ? (
          <span
            className={`sb-status ${status} activity-bar-status`}
            aria-hidden="true"
          >
            <i />
          </span>
        ) : (
          <span className="activity-bar-dot" aria-hidden="true" />
        ))}
    </button>
  );
}

/** A clock with a thread bubble: a thread that starts on a schedule. */
export function ScheduledThreadIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a9 9 0 1 0-9 9" />
      <path d="M11 6v5h3.5" />
      <path d="M22 15a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v7l2.5-2H21a1 1 0 0 0 1-1z" />
    </svg>
  );
}
