import type { ComponentPropsWithRef } from "react";
import "./line-divider.css";

/**
 * A short label between two hairlines: the quiet rows that mark a moment in a
 * thread (a compaction, an agent switch, where the unseen part starts) rather
 * than say something.
 */
export function LineDivider({
  tone,
  className,
  ...props
}: ComponentPropsWithRef<"div"> & { tone?: "accent" | "danger" }) {
  return (
    <div
      {...props}
      className={className ? `line-divider ${className}` : "line-divider"}
      data-tone={tone}
    />
  );
}
