// The Projects tree: groups that fold, drag and rename, and the projects in
// them with their latest threads.
import { ContextMenu } from "@base-ui/react/context-menu";
import { Menu } from "@base-ui/react/menu";
import {
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Settings2,
  SquarePen,
  Users,
} from "lucide-react";
import {
  parentGroup,
  type ProjectFolderNode,
} from "../../shared/project-folders";
import {
  projectNameSchema,
  type ChatSummary,
  type Project,
} from "../../shared/projects";
import { agentsSince } from "../../shared/waiting";
import { api } from "../lib/api";
import { dropSide, type ProjectDrag } from "../lib/useProjectDrag";
import type { ProjectGroups } from "../lib/useProjectGroups";
import { groupKey, type SidebarFolds } from "../lib/useSidebarFolds";
import { NameInput } from "./NameInput";
import { useProjectIcon } from "./ProjectBadge";
import { MenuAction, MenuPopup } from "./SidebarMenu";
import {
  firstThreads,
  ShowMore,
  ThreadRow,
  type SidebarRows,
} from "./SidebarThread";
import { IconButton, Spinner } from "./ui";

/** What every group and project in the tree works with. */
export interface ProjectTree {
  groups: ProjectGroups;
  drag: ProjectDrag;
  folds: SidebarFolds;
  rows: SidebarRows;
  /** Every listed thread; each project lists its own. */
  threads: ChatSummary[];
  /** The project the main pane is in, open until it's folded here. */
  current: string | undefined;
  onNew: (p: Project) => void;
  onShared: (p: Project) => void;
  /** Opens the project's page in Settings. */
  onProjectSettings: (p: Project) => void;
}

/** A group's insides: a new group's name field, its groups, then its projects. */
export function GroupContents({
  node,
  tree,
}: {
  node: ProjectFolderNode;
  tree: ProjectTree;
}) {
  const { groups } = tree;
  return (
    <>
      {groups.adding?.parent === node.path && (
        <NameInput
          label="New group name"
          onCancel={() => groups.setAdding(undefined)}
          onSubmit={(name) => {
            groups.setAdding(undefined);
            groups.createGroup(node.path, name, groups.adding?.project);
          }}
        />
      )}
      {node.folders.map((folder) => (
        <GroupSection key={folder.path} folder={folder} tree={tree} />
      ))}
      {node.projects.map((p) => (
        <ProjectSection key={p.id} project={p} tree={tree} />
      ))}
    </>
  );
}

function GroupSection({
  folder,
  tree,
}: {
  folder: ProjectFolderNode;
  tree: ProjectTree;
}) {
  const { groups, drag, folds } = tree;
  const key = groupKey(folder.path);
  const isOpen = folds.isOpen(key, true);
  const into = drag.drop?.kind === "folder" && drag.drop.path === folder.path;
  const empty =
    !folder.folders.length &&
    !folder.projects.length &&
    groups.adding?.parent !== folder.path;
  return (
    <section
      className={[
        "sb-folder",
        drag.draggingGroup === folder.path && "dragging",
        drag.drop?.kind === "group" &&
          drag.drop.path === folder.path &&
          `drop-${drag.drop.where}`,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Group ${folder.path}`}
      onDragOver={(e) => {
        // Groups only trade places with their siblings.
        const { draggingGroup } = drag;
        if (
          !draggingGroup ||
          draggingGroup === folder.path ||
          parentGroup(draggingGroup) !== parentGroup(folder.path)
        )
          return;
        drag.over(e, { kind: "group", path: folder.path, where: dropSide(e) });
      }}
      onDrop={(e) => drag.drop?.kind === "group" && drag.dropOn(e, drag.drop)}
    >
      {groups.renaming === folder.path ? (
        <NameInput
          label="Group name"
          initial={folder.name}
          onCancel={() => groups.setRenaming(undefined)}
          onSubmit={(name) => {
            groups.setRenaming(undefined);
            groups.renameGroup(folder.path, name, isOpen);
          }}
        />
      ) : (
        <ContextMenu.Root>
          <ContextMenu.Trigger
            className={`sb-folder-row ${into ? "drop-into" : ""}`}
            draggable
            onDragStart={(e) => drag.startGroup(e, folder.path)}
            onDragEnd={drag.end}
            onDragOver={(e) => {
              if (!drag.dragging) return;
              drag.over(e, { kind: "folder", path: folder.path });
              drag.openWhileDragging(key, isOpen);
            }}
            onDrop={(e) =>
              drag.dropOn(e, { kind: "folder", path: folder.path })
            }
          >
            <button
              className="sb-folder-toggle"
              aria-label={`${isOpen ? "Collapse" : "Expand"} group ${folder.path}`}
              aria-expanded={isOpen}
              title="Double-click to rename"
              onClick={() => folds.setOpen(key, !isOpen)}
              onDoubleClick={() => groups.setRenaming(folder.path)}
            >
              <span>{folder.name}</span>
              <ChevronRight size={11} />
            </button>
            <div className="sb-row-actions">
              <Menu.Root>
                <Menu.Trigger
                  className="icon-button"
                  aria-label={`Group actions for ${folder.path}`}
                  title="Group actions"
                >
                  <Ellipsis size={13} />
                </Menu.Trigger>
                <GroupMenu folder={folder} groups={groups} />
              </Menu.Root>
            </div>
          </ContextMenu.Trigger>
          <GroupMenu folder={folder} groups={groups} />
        </ContextMenu.Root>
      )}
      {isOpen && (
        <div className="sb-folder-body">
          <GroupContents node={folder} tree={tree} />
          {empty && (
            <div
              className={`sb-group-empty ${into ? "drop-into" : ""}`}
              onDragOver={(e) =>
                drag.over(e, { kind: "folder", path: folder.path })
              }
              onDrop={(e) =>
                drag.dropOn(e, { kind: "folder", path: folder.path })
              }
            >
              <FolderInput size={13} />
              {drag.dragging ? "Drop here" : "Drag projects here"}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function GroupMenu({
  folder,
  groups,
}: {
  folder: ProjectFolderNode;
  groups: ProjectGroups;
}) {
  return (
    <MenuPopup side="bottom" align="end">
      <MenuAction
        icon={<Pencil size={13} />}
        onClick={() => {
          groups.setAdding(undefined);
          groups.setRenaming(folder.path);
        }}
      >
        Rename
      </MenuAction>
      <MenuAction
        icon={<FolderPlus size={13} />}
        onClick={() => groups.startGroup(folder.path)}
      >
        New group inside
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderMinus size={13} />}
        hint="Projects stay"
        onClick={() => groups.removeGroup(folder.path)}
      >
        Remove group
      </MenuAction>
    </MenuPopup>
  );
}

function ProjectFolderIcon({ id, open }: { id: string; open: boolean }) {
  const icon = useProjectIcon(id);
  if (icon) return <img className="sb-project-icon" src={icon} alt="" />;
  return open ? <FolderOpen size={15} /> : <Folder size={15} />;
}

function ProjectSection({
  project: p,
  tree: {
    groups,
    drag,
    folds,
    rows,
    threads,
    current,
    onNew,
    onShared,
    onProjectSettings,
  },
}: {
  project: Project;
  tree: ProjectTree;
}) {
  const chats = threads.filter((c) => c.projectId === p.id);
  const isOpen = folds.isOpen(p.id, p.id === current);
  const more = folds.showsAll(p.id);
  const busy = chats.some((c) => c.running || agentsSince(c.pending));
  return (
    <section
      className={[
        "sb-project",
        p.id === current && "current",
        drag.dragging === p.id && "dragging",
        drag.drop?.kind === "project" &&
          drag.drop.id === p.id &&
          drag.dragging !== p.id &&
          `drop-${drag.drop.where}`,
      ]
        .filter(Boolean)
        .join(" ")}
      onDragOver={(e) =>
        drag.over(e, { kind: "project", id: p.id, where: dropSide(e) })
      }
      onDrop={(e) => drag.drop?.kind === "project" && drag.dropOn(e, drag.drop)}
    >
      {groups.renamingProject === p.id ? (
        <div className="sb-project-row">
          <span className="sb-project-expand">
            <ProjectFolderIcon id={p.id} open={isOpen} />
          </span>
          <NameInput
            label="Project name"
            initial={p.name}
            schema={projectNameSchema}
            placeholder="Project name"
            className="sb-group-input sb-project-input"
            onCancel={() => groups.setRenamingProject(undefined)}
            onSubmit={(name) => {
              groups.setRenamingProject(undefined);
              groups.renameProject(p.id, name);
            }}
          />
        </div>
      ) : (
        <ContextMenu.Root>
          <ContextMenu.Trigger
            className="sb-project-row"
            draggable
            onDragStart={(e) => drag.startProject(e, p.id)}
            onDragEnd={drag.end}
          >
            <button
              className="sb-project-expand"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`}
              aria-expanded={isOpen}
              onClick={() => folds.setOpen(p.id, !isOpen)}
            >
              <ProjectFolderIcon id={p.id} open={isOpen} />
            </button>
            {/* Like a group label, the whole row toggles; only its actions don't. */}
            <button
              className="sb-project-name"
              title={p.path}
              aria-expanded={isOpen}
              onClick={() => folds.setOpen(p.id, !isOpen)}
            >
              <span>{p.name}</span>
              <ChevronRight
                size={11}
                className="sb-project-chevron"
                data-open={isOpen || undefined}
                aria-hidden
              />
              {busy && !isOpen && (
                <span className="sb-status running" title="Working">
                  <Spinner size={11} steady />
                </span>
              )}
            </button>
            <div className="sb-row-actions">
              <Menu.Root>
                <Menu.Trigger
                  className="icon-button"
                  aria-label={`Project actions for ${p.name}`}
                  title="Project actions"
                >
                  <Ellipsis size={13} />
                </Menu.Trigger>
                <ProjectMenu
                  project={p}
                  groups={groups}
                  onNew={onNew}
                  onSettings={onProjectSettings}
                />
              </Menu.Root>
              <IconButton
                label={`Shared conversations in ${p.name}`}
                onClick={() => onShared(p)}
              >
                <Users size={13} />
              </IconButton>
              <IconButton
                label={`New thread in ${p.name}`}
                onClick={() => onNew(p)}
              >
                <Plus size={14} />
              </IconButton>
            </div>
          </ContextMenu.Trigger>
          <ProjectMenu
            project={p}
            groups={groups}
            onNew={onNew}
            onSettings={onProjectSettings}
          />
        </ContextMenu.Root>
      )}
      {isOpen && (
        <div className="sb-thread-list">
          {firstThreads(chats, more).map((c) => (
            <ThreadRow key={c.id} chat={c} rows={rows} />
          ))}
          {!chats.length && (
            <button className="sb-thread sb-ghost" onClick={() => onNew(p)}>
              <span className="sb-thread-title">Start a thread</span>
            </button>
          )}
          <ShowMore
            total={chats.length}
            more={more}
            onToggle={() => folds.setShowsAll(p.id, !more)}
          />
        </div>
      )}
    </section>
  );
}

function ProjectMenu({
  project: p,
  groups,
  onNew,
  onSettings,
}: {
  project: Project;
  groups: ProjectGroups;
  onNew: (p: Project) => void;
  onSettings: (p: Project) => void;
}) {
  return (
    <MenuPopup side="bottom" align="end">
      <MenuAction
        icon={<Pencil size={13} />}
        onClick={() => groups.setRenamingProject(p.id)}
      >
        Rename
      </MenuAction>
      <MenuAction icon={<SquarePen size={13} />} onClick={() => onNew(p)}>
        New thread
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderOpen size={13} />}
        onClick={() => groups.reveal(p.id)}
      >
        Open in Finder
      </MenuAction>
      <MenuAction
        icon={<Copy size={13} />}
        onClick={() => void api.writeClipboard(p.path)}
      >
        Copy path
      </MenuAction>
      <MenuAction icon={<Settings2 size={13} />} onClick={() => onSettings(p)}>
        Project settings
      </MenuAction>
      <Menu.Separator className="sb-menu-separator" />
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger className="sb-menu-item">
          <span className="sb-menu-label">
            <FolderInput size={13} />
            Move to group
          </span>
          <ChevronRight size={12} />
        </Menu.SubmenuTrigger>
        <MoveMenu project={p} groups={groups} />
      </Menu.SubmenuRoot>
    </MenuPopup>
  );
}

function MoveMenu({
  project: p,
  groups,
}: {
  project: Project;
  groups: ProjectGroups;
}) {
  return (
    <MenuPopup side="right" align="start">
      {groups.paths.map((path) => (
        <Menu.Item
          key={path}
          className="sb-menu-item"
          disabled={path === (p.folder ?? "")}
          onClick={() => groups.moveProject(p.id, { kind: "folder", path })}
        >
          <span className="sb-menu-group">
            {path.split("/").map((name, i, parts) => (
              <span key={i} className={i < parts.length - 1 ? "parent" : ""}>
                {name}
              </span>
            ))}
          </span>
          {path === p.folder && <Check size={13} />}
        </Menu.Item>
      ))}
      {p.folder && (
        <MenuAction
          icon={<FolderMinus size={13} />}
          onClick={() => groups.moveProject(p.id, { kind: "folder", path: "" })}
        >
          Remove from group
        </MenuAction>
      )}
      {groups.paths.length > 0 && (
        <Menu.Separator className="sb-menu-separator" />
      )}
      <MenuAction
        icon={<FolderPlus size={13} />}
        onClick={() => groups.startGroup("", p.id)}
      >
        New group…
      </MenuAction>
    </MenuPopup>
  );
}
