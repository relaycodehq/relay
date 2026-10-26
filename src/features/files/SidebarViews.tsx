import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { SideView } from "./file-link-target";

export type SidebarView = {
  id: SideView;
  label: string;
  /** Files in it, beside its name. */
  count?: number;
  content: ReactNode;
};

/**
 * The editor's sidebar: the folder's files, what changed in it, or what its
 * worktree has that its branch doesn't, as an IDE's Project and Commit views
 * share one side. One view needs no switch.
 */
export function SidebarViews({
  views,
  shown,
  onShow,
  onNamesWidth,
}: {
  views: SidebarView[];
  shown: SideView;
  onShow: (view: SideView) => void;
  /** How wide the row of names needs to be to show them all; 0 without the row. */
  onNamesWidth?: (width: number) => void;
}) {
  const front = views.find((view) => view.id === shown) ?? views[0];
  const row = useRef<HTMLDivElement>(null);
  const names = views.map((view) => `${view.label} ${view.count ?? ""}`).join("|");
  useLayoutEffect(() => {
    const element = row.current;
    if (!onNamesWidth) return;
    if (!element) return onNamesWidth(0);
    // Not while the list is hidden, when everything in it measures 0.
    const measure = () => element.clientWidth && onNamesWidth(namesWidth(element));
    measure();
    const resizes = new ResizeObserver(measure);
    resizes.observe(element);
    void document.fonts.ready.then(measure);
    return () => resizes.disconnect();
  }, [names, onNamesWidth]);
  if (views.length < 2) return front?.content;
  return (
    <>
      <div ref={row} className="sidebar-views" role="tablist" aria-label="Sidebar">
        {views.map((view) => (
          <button
            key={view.id}
            role="tab"
            aria-selected={view === front}
            className={view === front ? "active" : ""}
            onClick={() => onShow(view.id)}
          >
            {view.label}
            {!!view.count && <span className="sidebar-views-count">{view.count}</span>}
          </button>
        ))}
      </div>
      {front.content}
    </>
  );
}

/** The row's width with every name in full: to the end of the last, and the padding after it. */
function namesWidth(row: HTMLElement) {
  const last = row.lastElementChild;
  if (!last) return 0;
  const end = last.getBoundingClientRect().right - row.getBoundingClientRect().left + row.scrollLeft;
  return Math.ceil(end + parseFloat(getComputedStyle(row).paddingRight));
}
