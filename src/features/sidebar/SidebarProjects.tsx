// The sidebar's Projects view sections: Scratchpad's chats, and the projects
// under their heading, which takes projects dragged out of their groups.
import { Menu } from "@base-ui/react/menu";
import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Link2,
  Plus,
  Import as ImportIcon,
} from "lucide-react";
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
import { GitHubMark } from "../../ui/BrandIcons";
import type { AddProjectPage } from "../add-project/AddProjectPalette";
import { MenuAction, MenuPopup } from "./SidebarMenu";

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
  const pages = folds.pages("scratchpad");
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
          {firstThreads(chats, pages).map((c) => (
            <ThreadRow key={c.id} chat={c} rows={rows} />
          ))}
          {!chats.length && !draft && (
            <button className="sb-thread sb-ghost" onClick={onNew}>
              <span className="sb-thread-title">Ask anything</span>
            </button>
          )}
          <ShowMore
            total={chats.length}
            pages={pages}
            onMore={() => folds.showMore("scratchpad")}
            onLess={() => folds.showLess("scratchpad")}
          />
        </div>
      )}
    </section>
  );
}

/** The ways to add a project, each opening the palette on its page. */
function AddMenu({ onAdd }: { onAdd: (page: AddProjectPage) => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="icon-button"
        title="Add project"
        aria-label="Add project"
      >
        <Plus size={14} />
      </Menu.Trigger>
      <MenuPopup side="bottom" align="end">
        <MenuAction
          icon={<FolderPlus size={14} />}
          onClick={() => onAdd("new")}
        >
          New project
        </MenuAction>
        <MenuAction
          icon={<FolderOpen size={14} />}
          onClick={() => onAdd("folder")}
        >
          Open a folder
        </MenuAction>
        <MenuAction
          icon={<GitHubMark size={14} />}
          onClick={() => onAdd("github")}
        >
          Clone from GitHub
        </MenuAction>
        <MenuAction icon={<Link2 size={14} />} onClick={() => onAdd("url")}>
          Clone from a URL
        </MenuAction>
        <MenuAction
          icon={<ImportIcon size={14} />}
          onClick={() => onAdd("import")}
        >
          Import from another app…
        </MenuAction>
      </MenuPopup>
    </Menu.Root>
  );
}

/** With no projects yet, the + menu's ways in, spelled out under the heading. */
function AddWays({ onAdd }: { onAdd: (page: AddProjectPage) => void }) {
  return (
    <div className="sb-thread-list flat sb-add-ways">
      <button className="sb-thread" onClick={() => onAdd("new")}>
        <FolderPlus size={14} />
        <span className="sb-thread-title">New project</span>
      </button>
      <button className="sb-thread" onClick={() => onAdd("folder")}>
        <FolderOpen size={14} />
        <span className="sb-thread-title">Open a folder</span>
      </button>
      <button className="sb-thread" onClick={() => onAdd("github")}>
        <GitHubMark size={14} />
        <span className="sb-thread-title">Clone a repository</span>
      </button>
      <button className="sb-thread" onClick={() => onAdd("import")}>
        <ImportIcon size={14} />
        <span className="sb-thread-title">Import from another app…</span>
      </button>
    </div>
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
  onAdd: (page: AddProjectPage) => void;
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
          <AddMenu onAdd={onAdd} />
        </div>
      </div>
      {error && <p className="sb-note error">{error}</p>}
      {!folds.folded.projects && (
        <GroupContents node={tree.shown} tree={tree} />
      )}
      {!folds.folded.projects && empty && <AddWays onAdd={onAdd} />}
    </>
  );
}
