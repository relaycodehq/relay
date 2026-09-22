import { useEffect, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  ChevronRight,
  FolderGit2,
  Folder,
  FolderOpen,
  MessageSquare,
  GitPullRequest,
  Users,
  Settings2,
  LogIn,
} from "lucide-react";
import type { Project, ChatSummary } from "../../shared/projects";
import { api } from "../lib/api";
import { IconButton } from "./ui";
import { ProjectFolderDialog } from "./ProjectFolderDialog";
import {
  projectFolderTree,
  type ProjectFolderNode,
} from "../../shared/project-folders";
export function ProjectSidebar({
  projects,
  projectId,
  chatId,
  dirty,
  account,
  onProject,
  onChat,
  onNew,
  onAdd,
  onShared,
  onSettings,
  onAccount,
  onInbox,
}: {
  projects: Project[];
  projectId?: string;
  chatId?: string;
  dirty: boolean;
  account?: string;
  onProject: (p: Project) => void;
  onChat: (c: ChatSummary) => void;
  onNew: (p: Project) => void;
  onAdd: () => void;
  onShared: (p: Project) => void;
  onSettings: () => void;
  onAccount: () => void;
  onInbox: () => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("relay-project-expansion") ?? "{}",
      );
      return Object.fromEntries(
        Object.entries(saved)
          .filter(([, value]) => typeof value === "boolean")
          .map(([key, value]) => [key, value === true]),
      );
    } catch {
      return {};
    }
  });
  useEffect(() => {
    localStorage.setItem("relay-project-expansion", JSON.stringify(expanded));
  }, [expanded]);
  const [organizing, setOrganizing] = useState<string | null>(null);
  const lists = useQueries({
    queries: projects.map((p) => ({
      queryKey: ["project-chats", p.id],
      queryFn: () => api.projectChats(p.id),
      refetchInterval: 10000,
    })),
  });
  useEffect(
    () =>
      api.onProjectChat((e) => {
        if (
          e.title ||
          e.message.role === "user" ||
          e.message.status !== "streaming"
        )
          void qc.invalidateQueries({ queryKey: ["project-chats"] });
      }),
    [qc],
  );
  const all = lists
    .flatMap((q) => q.data ?? [])
    .sort((a, b) => b.updated - a.updated);
  const matches = (c: ChatSummary) =>
    `${c.title} ${projects.find((p) => p.id === c.projectId)?.name ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const row = (c: ChatSummary, recent = false) => (
    <button
      key={c.id}
      className={`thread-nav-row ${chatId === c.id ? "selected" : ""}`}
      disabled={dirty}
      title={c.title}
      onClick={() => onChat(c)}
    >
      {c.scope.kind === "pr" ? (
        <GitPullRequest size={14} />
      ) : c.shared ? (
        <Users size={14} />
      ) : (
        <MessageSquare size={14} />
      )}
      <span>{c.title}</span>
      {recent && (
        <small>{projects.find((p) => p.id === c.projectId)?.name}</small>
      )}
    </button>
  );
  const renderProject = (p: Project) => {
    const i = projects.findIndex((entry) => entry.id === p.id);
    const open = expanded[p.id] ?? p.id === projectId;
    return (
      <section key={p.id} className="sidebar-project">
        <div className="project-nav-heading">
          <button
            className="project-expand"
            aria-label={`${open ? "Collapse" : "Expand"} ${p.name}`}
            aria-expanded={open}
            onClick={() => setExpanded((s) => ({ ...s, [p.id]: !open }))}
          >
            <ChevronRight size={12} />
          </button>
          <button
            className="project-select"
            disabled={dirty}
            title={`${p.path} · Right-click to organize`}
            onContextMenu={(e) => {
              e.preventDefault();
              setOrganizing(p.id);
            }}
            onClick={() => {
              onProject(p);
              setExpanded((s) => ({ ...s, [p.id]: true }));
            }}
          >
            <FolderGit2 size={15} />
            <span>{p.name}</span>
          </button>
          <IconButton
            label={`New thread in ${p.name}`}
            disabled={dirty}
            onClick={() => onNew(p)}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        {open && (
          <div className="project-chat-list">
            {(lists[i].data ?? []).filter(matches).map((c) => row(c))}
            <button
              className="new-project-chat"
              disabled={dirty}
              onClick={() => onNew(p)}
            >
              <Plus size={13} />
              New thread
            </button>
            <button
              className="new-project-chat"
              disabled={dirty}
              onClick={() => onShared(p)}
            >
              <Users size={13} />
              Shared conversations
            </button>
          </div>
        )}
      </section>
    );
  };
  function renderFolder(node: ProjectFolderNode): React.ReactNode {
    return (
      <>
        {node.folders.map((folder) => {
          const key = "folder:" + folder.path;
          const open = expanded[key] ?? true;
          return (
            <section
              key={folder.path}
              className="virtual-project-folder"
              aria-label={`Folder ${folder.path}`}
            >
              <button
                className="virtual-folder-heading"
                aria-label={`${open ? "Collapse" : "Expand"} folder ${folder.path}`}
                aria-expanded={open}
                onClick={() =>
                  setExpanded((state) => ({ ...state, [key]: !open }))
                }
              >
                <ChevronRight size={12} />
                {open ? <FolderOpen size={15} /> : <Folder size={15} />}
                <span>{folder.name}</span>
              </button>
              {open && (
                <div className="virtual-folder-children">
                  {renderFolder(folder)}
                </div>
              )}
            </section>
          );
        })}
        {node.projects.map(renderProject)}
      </>
    );
  }
  return (
    <>
      {organizing !== null && (
        <ProjectFolderDialog
          projects={projects}
          initial={organizing}
          onClose={() => setOrganizing(null)}
        />
      )}
      <div className="sidebar-search">
        <Search size={15} />
        <input
          aria-label="Search threads"
          placeholder="Search threads…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="projects-list">
        <section className="recent-threads">
          <h2>{search ? "Search results" : "Recent"}</h2>
          {all
            .filter(matches)
            .slice(0, search ? 30 : 5)
            .map((c) => row(c, true))}
          {!all.filter(matches).length && (
            <p className="sidebar-empty-note">
              {search
                ? "No matching threads."
                : "Your conversations will appear here."}
            </p>
          )}
        </section>
        <div className="sidebar-section-heading">
          <h2>Projects</h2>
          <div className="sidebar-heading-actions">
            <IconButton
              label="Organize projects"
              disabled={!projects.length}
              onClick={() => setOrganizing(projectId ?? projects[0]?.id ?? "")}
            >
              <Folder size={15} />
            </IconButton>
            <IconButton label="Add project" disabled={dirty} onClick={onAdd}>
              <Plus size={15} />
            </IconButton>
          </div>
        </div>
        {renderFolder(projectFolderTree(projects))}
        {!projects.length && (
          <p className="project-sidebar-note">
            Add a local Git folder to get started.
          </p>
        )}
      </div>
      <footer>
        <button disabled={dirty} onClick={onInbox}>
          <GitPullRequest size={15} />
          Pull request inbox
        </button>
        <div className="sidebar-account">
          <button onClick={onAccount}>
            <LogIn size={14} />
            {account ?? "Connect Gitea"}
          </button>
          <IconButton label="Open settings" onClick={onSettings}>
            <Settings2 size={15} />
          </IconButton>
        </div>
      </footer>
    </>
  );
}
