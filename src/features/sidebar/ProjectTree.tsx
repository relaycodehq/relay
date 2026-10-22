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
  FolderX,
  Pencil,
  Plus,
  Settings2,
  SquarePen,
} from "lucide-react";
import {
  parentGroup,
  type ProjectFolderNode,
} from "../../../shared/project-folders";
import {
  projectNameSchema,
  type ChatSummary,
  type Project,
} from "../../../shared/projects";
import { agentsSince } from "../../../shared/waiting";
import { api } from "../../lib/api";
import { dropSide, type ProjectDrag } from "./useProjectDrag";
import { ghostKey } from "../../../shared/import-offer";
import type { ProjectGroups } from "./useProjectGroups";
import { groupKey, type SidebarFolds } from "./useSidebarFolds";
import { NameInput } from "../../ui/NameInput";
import { useProjectIcon } from "../projects/ProjectBadge";
import {
  projectComputer,
  usePairedComputers,
} from "../handoff/usePairedComputers";
import { MenuAction, MenuPopup } from "./SidebarMenu";
import {
  firstThreads,
  ShowMore,
  ThreadRow,
  type SidebarRows,
} from "./SidebarThread";
import { IconButton, Spinner } from "../../ui/ui";
import { fileManager } from "../../lib/mod-key";

/** What every group and project in the tree works with. */
export interface ProjectTree {
  groups: ProjectGroups;
  /** The groups' tree as listed: only the projects the filter takes. */
  shown: ProjectFolderNode;
  drag: ProjectDrag;
  folds: SidebarFolds;
  rows: SidebarRows;
  /** Every listed thread; each project lists its own. */
  threads: ChatSummary[];
  /** The project the main pane is in, open until it's folded here. */
  current: string | undefined;
  onNew: (p: Project) => void;
  /** Opens the project's page in Settings. */
  onProjectSettings: (p: Project) => void;
  /** An import plan's chats coming into each project, its stand-ins' included. */
  importing?: Map<string, number>;
}

/** A group's insides: a new group's name field, its groups, then its projects. */
export function GroupContents({
  node,
  tree,
  root = false,
}: {
  node: ProjectFolderNode;
  tree: ProjectTree;
  /** The top of the tree, whose projects are in no group. */
  root?: boolean;
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
      {root && node.folders.length > 0 && node.projects.length > 0 ? (
        <Ungrouped projects={node.projects} tree={tree} />
      ) : (
        node.projects.map((p) => (
          <ProjectSection key={p.id} project={p} tree={tree} />
        ))
      )}
    </>
  );
}

/** How many projects a group holds, its groups' included. */
const projectCount = (node: ProjectFolderNode): number =>
  node.projects.length +
  node.folders.reduce((sum, f) => sum + projectCount(f), 0);

/** Once there are groups, the projects in none get a label like theirs. */
function Ungrouped({
  projects,
  tree,
}: {
  projects: Project[];
  tree: ProjectTree;
}) {
  const { drag, folds } = tree;
  const key = groupKey("");
  const isOpen = folds.isOpen(key, true);
  const into = drag.drop?.kind === "folder" && drag.drop.path === "";
  return (
    <section className="sb-folder" aria-label="Projects in no group">
      <div
        className={`sb-folder-row ${into ? "drop-into" : ""}`}
        onDragOver={(e) => {
          if (!drag.dragging) return;
          drag.over(e, { kind: "folder", path: "" });
          drag.openWhileDragging(key, isOpen);
        }}
        onDrop={(e) => drag.dropOn(e, { kind: "folder", path: "" })}
      >
        <button
          className="sb-folder-toggle"
          aria-label={`${isOpen ? "Collapse" : "Expand"} projects in no group`}
          aria-expanded={isOpen}
          onClick={() => folds.setOpen(key, !isOpen)}
        >
          <span>Other</span>
          <ChevronRight size={11} />
          <span className="sb-folder-count">{projects.length}</span>
        </button>
      </div>
      {isOpen && (
        <div className="sb-folder-body">
          {projects.map((p) => (
            <ProjectSection key={p.id} project={p} tree={tree} />
          ))}
        </div>
      )}
    </section>
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
  const count = projectCount(folder);
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
              {count > 0 && <span className="sb-folder-count">{count}</span>}
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

/** A project an import would add: dimmed, dragged into place, nothing else until it's imported. */
function PlannedProject({
  project: p,
  tree,
}: {
  project: Project;
  tree: ProjectTree;
}) {
  const { drag } = tree;
  const chats = tree.importing?.get(p.id) ?? 0;
  return (
    <section
      className={[
        "sb-project",
        "sb-planned",
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
      <div
        className="sb-project-row"
        draggable
        title={`${p.path}\nNot imported yet. Drag to place it.`}
        onDragStart={(e) => drag.startProject(e, p.id)}
        onDragEnd={drag.end}
      >
        <span className="sb-project-expand">
          <Folder size={15} />
        </span>
        <span className="sb-project-name">
          <span>{p.name}</span>
          {chats > 0 && <span className="sb-planned-chats">+{chats}</span>}
        </span>
      </div>
    </section>
  );
}

function ProjectSection({
  project,
  tree,
}: {
  project: Project;
  tree: ProjectTree;
}) {
  return ghostKey(project.id) ? (
    <PlannedProject project={project} tree={tree} />
  ) : (
    <RealProject project={project} tree={tree} />
  );
}

function RealProject({
  project: p,
  tree: {
    groups,
    drag,
    folds,
    rows,
    threads,
    current,
    onNew,
    onProjectSettings,
    importing,
  },
}: {
  project: Project;
  tree: ProjectTree;
}) {
  const chats = threads.filter((c) => c.projectId === p.id);
  const incoming = importing?.get(p.id) ?? 0;
  const computers = usePairedComputers(!!p.computer);
  const where = projectComputer(p, computers.data);
  const isOpen = folds.isOpen(p.id, p.id === current);
  const pages = folds.pages(p.id);
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
              className={`sb-project-name${where && !where.online ? " offline" : ""}`}
              title={
                where
                  ? `${p.path} on ${where.name}${where.online ? "" : ", offline"}`
                  : p.path
              }
              aria-expanded={isOpen}
              onClick={() => folds.setOpen(p.id, !isOpen)}
            >
              <span>{p.name}</span>
              {where && <span className="sb-project-where">{where.name}</span>}
              {incoming > 0 && (
                <span
                  className="sb-planned-chats"
                  title={`${incoming} ${incoming === 1 ? "chat" : "chats"} to import`}
                >
                  +{incoming}
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
                label={`New thread in ${p.name}`}
                onClick={() => onNew(p)}
              >
                <Plus size={14} />
              </IconButton>
            </div>
            {/* After the actions, so the spinner and chevron stay the row's last
                items. The name button above is the accessible toggle. */}
            <button
              className="sb-project-chevron-button"
              tabIndex={-1}
              aria-hidden
              onClick={() => folds.setOpen(p.id, !isOpen)}
            >
              {busy && !isOpen && (
                <span className="sb-status running" title="Working">
                  <Spinner size={11} steady />
                </span>
              )}
              <ChevronRight
                size={11}
                className="sb-project-chevron"
                data-open={isOpen || undefined}
              />
            </button>
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
          {firstThreads(chats, pages).map((c) => (
            <ThreadRow key={c.id} chat={c} rows={rows} />
          ))}
          {!chats.length && (
            <button className="sb-thread sb-ghost" onClick={() => onNew(p)}>
              <span className="sb-thread-title">Start a thread</span>
            </button>
          )}
          <ShowMore
            total={chats.length}
            pages={pages}
            onMore={() => folds.showMore(p.id)}
            onLess={() => folds.showLess(p.id)}
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
        Open in {fileManager}
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
      <Menu.Separator className="sb-menu-separator" />
      <MenuAction
        icon={<FolderX size={13} />}
        hint="Folder stays"
        onClick={() => groups.removeProject(p.id)}
      >
        Remove from Relay
      </MenuAction>
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
