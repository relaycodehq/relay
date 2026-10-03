// The sidebar's Projects view sections: Scratchpad's chats, and the projects
// under their heading, which takes projects dragged out of their groups.
import { ChevronRight, FolderPlus, Plus } from "lucide-react";
import type { ChatSummary } from "../../../shared/projects";
import { useShortcutLabel } from "../../lib/shortcuts";
import type { SidebarFolds } from "./useSidebarFolds";
import { GroupContents, type ProjectTree } from "./ProjectTree";
import {
  firstThreads,
  ShowMore,
  ThreadRow,
  type SidebarRows,
} from "./SidebarThread";
import { IconButton } from "../../ui/ui";

/** A section's heading; the label folds the list beneath it. */
function SectionTitle({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <h2>
      <button
        className="sb-section-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
        <ChevronRight
          size={11}
          className="sb-project-chevron"
          data-open={open || undefined}
          aria-hidden
        />
      </button>
    </h2>
  );
}

export function Scratchpad({
  chats,
  draft,
  rows,
  folds,
  onNew,
}: {
  chats: ChatSummary[];
  /** The open Scratchpad chat, before its first message. */
  draft: boolean;
  rows: SidebarRows;
  folds: SidebarFolds;
  onNew: () => void;
}) {
  const newKeys = useShortcutLabel("new-scratch");
  const more = folds.showsAll("scratchpad");
  return (
    <section className="sb-scratchpad">
      <div className="sb-section-heading">
        <SectionTitle
          label="Scratchpad"
          open={!folds.folded.scratchpad}
          onToggle={() => folds.fold("scratchpad")}
        />
        <IconButton label={`New chat  ${newKeys}`.trim()} onClick={onNew}>
          <Plus size={14} />
        </IconButton>
      </div>
      {!folds.folded.scratchpad && (
        <div className="sb-thread-list flat">
          {draft && (
            <div className="sb-thread-row">
              <button className="sb-thread selected" disabled>
                <span className="sb-thread-title">New chat</span>
              </button>
            </div>
          )}
          {firstThreads(chats, more).map((c) => (
            <ThreadRow key={c.id} chat={c} rows={rows} />
          ))}
          {!chats.length && !draft && (
            <button className="sb-thread sb-ghost" onClick={onNew}>
              <span className="sb-thread-title">Ask anything</span>
            </button>
          )}
          <ShowMore
            total={chats.length}
            more={more}
            onToggle={() => folds.setShowsAll("scratchpad", !more)}
          />
        </div>
      )}
    </section>
  );
}

/** The Projects heading, a note for what failed, and the tree. */
export function ProjectsSection({
  tree,
  error,
  empty,
  onAdd,
}: {
  tree: ProjectTree;
  error: string | undefined;
  /** There are no projects yet. */
  empty: boolean;
  onAdd: () => void;
}) {
  const { drag, folds, groups } = tree;
  return (
    <>
      <div
        className={`sb-section-heading ${
          drag.drop?.kind === "folder" && drag.drop.path === ""
            ? "drop-into"
            : ""
        }`}
        title={drag.dragging ? "Drop to move out of groups" : undefined}
        onDragOver={(e) => drag.over(e, { kind: "folder", path: "" })}
        onDrop={(e) => drag.dropOn(e, { kind: "folder", path: "" })}
      >
        <SectionTitle
          label="Projects"
          open={!folds.folded.projects}
          onToggle={() => folds.fold("projects")}
        />
        <div className="sb-heading-actions">
          <div className="sb-row-actions">
            <IconButton label="New group" onClick={() => groups.startGroup("")}>
              <FolderPlus size={13} />
            </IconButton>
          </div>
          <IconButton label="Add project" onClick={onAdd}>
            <Plus size={14} />
          </IconButton>
        </div>
      </div>
      {error && <p className="sb-note error">{error}</p>}
      {!folds.folded.projects && (
        <GroupContents node={groups.tree} tree={tree} />
      )}
      {!folds.folded.projects && empty && (
        <p className="sb-note">Add a project folder to get started.</p>
      )}
    </>
  );
}
