import type { ReactNode } from "react";
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
}: {
  views: SidebarView[];
  shown: SideView;
  onShow: (view: SideView) => void;
}) {
  const front = views.find((view) => view.id === shown) ?? views[0];
  if (views.length < 2) return front?.content;
  return (
    <>
      <div className="sidebar-views" role="tablist" aria-label="Sidebar">
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
