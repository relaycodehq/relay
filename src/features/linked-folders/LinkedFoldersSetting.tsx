// Linked folders in project settings: what every thread in the project
// may reach beyond it, with a note the agent is told, and how far it may go.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2, FolderOpen, FolderSymlink, Plus, X } from "lucide-react";
import {
  linkName,
  tildePath,
  type LinkAccess,
  type LinkedFolder,
  type Project,
} from "../../../shared/projects";
import { api } from "../../lib/api";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { SearchSelect } from "../../ui/SearchSelect";
import { ErrorBox, IconButton } from "../../ui/ui";
import { useProjectSetting } from "../projects/ProjectSettings";
import "./linked-folders.css";

export const accessOptions: {
  value: LinkAccess;
  label: string;
  description: string;
}[] = [
  {
    value: "read",
    label: "Read only",
    description: "Reads and searches it without asking. Edits there ask first.",
  },
  {
    value: "write",
    label: "Read and write",
    description:
      "Edits it too, as freely as the project, under the thread's permissions.",
  },
];

/** Link folder: folders beside the project and the other projects, or Finder. */
export function LinkMenu({
  project,
  linked,
  onLink,
  label = "Link folder",
}: {
  project: Project;
  linked: readonly LinkedFolder[];
  onLink: (path: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useQuery({
    queryKey: ["link-suggestions", project.id],
    queryFn: () => api.linkSuggestions(project.id),
    enabled: open,
    staleTime: 30_000,
  });
  const taken = new Set(linked.map((l) => l.path));
  return (
    <SearchSelect
      label={label}
      trigger={
        <>
          <Plus size={13} />
          {label}
        </>
      }
      triggerClassName="linked-add"
      className="linked-menu"
      placeholder="Search folders and projects…"
      options={(suggestions.data ?? [])
        .filter((s) => !taken.has(s.path))
        .sort((a, b) => Number(b.beside) - Number(a.beside))
        .map((s) => ({
          value: s.path,
          label: s.project ?? linkName(s.path),
          detail: tildePath(s.path),
          icon: s.repository ? (
            <FolderGit2 size={14} />
          ) : (
            <FolderSymlink size={14} />
          ),
          group: s.beside ? `Beside ${project.name}` : "Your projects",
        }))}
      onChange={onLink}
      onOpenChange={setOpen}
      empty={
        suggestions.isPending
          ? "Looking for folders…"
          : "No folders to suggest."
      }
      action={{
        label: "Choose a folder…",
        icon: <FolderOpen size={14} />,
        onSelect: () =>
          void api.chooseFolder("Link a folder").then((path) => {
            if (path) onLink(path);
          }),
      }}
    />
  );
}

function LinkedFolderRow({
  link,
  onChange,
  onRemove,
}: {
  link: LinkedFolder;
  onChange: (next: LinkedFolder) => void;
  onRemove: () => void;
}) {
  const name = linkName(link.path);
  // Saved when it loses focus, not on every key.
  const [note, setNote] = useState(link.note ?? "");
  useEffect(() => setNote(link.note ?? ""), [link.note]);
  return (
    <li className="linked-row">
      <FolderSymlink size={15} className="linked-icon" />
      <div className="linked-main">
        <div className="linked-title">
          <strong>{name}</strong>
          <span className="linked-path" title={link.path}>
            {tildePath(link.path)}
          </span>
        </div>
        <input
          className="linked-note"
          aria-label={`What's in ${name}`}
          placeholder="What's in here, in a line the agent reads"
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            const next = note.trim();
            if (next === (link.note ?? "")) return;
            const { note: _, ...rest } = link;
            onChange(next ? { ...rest, note: next } : rest);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {link.access === "write" && (
          <p className="linked-warning">
            Edits land in this folder itself, not in a thread's worktree, and
            Changes doesn't list them.
          </p>
        )}
      </div>
      <div className="composer-tools model-field linked-access">
        <ComposerSelect<LinkAccess>
          label="Access"
          value={link.access}
          options={accessOptions}
          onChange={(access) => onChange({ ...link, access })}
        />
      </div>
      <IconButton label={`Unlink ${name}`} onClick={onRemove}>
        <X size={14} />
      </IconButton>
    </li>
  );
}

/** The project's linked folders, saved as they change, and Link folder under them. */
export function LinkedFoldersSetting({ project }: { project: Project }) {
  const setting = useProjectSetting(project, "links");
  const links = setting.value ?? [];
  const [error, setError] = useState<unknown>();
  const save = (next: LinkedFolder[]) => {
    setError(undefined);
    setting.change(next.length ? next : undefined);
  };
  async function link(path: string) {
    const info = await api.inspectFolder(path);
    if (info.kind === "missing" || info.kind === "file")
      return setError(new Error(`${tildePath(info.path)} isn't a folder.`));
    if (info.path === project.path)
      return setError(new Error(`That's ${project.name}'s own folder.`));
    if (links.some((l) => l.path === info.path)) return;
    save([...links, { path: info.path, access: "read" }]);
  }
  return (
    <div className="linked-folders">
      {links.length ? (
        <ul>
          {links.map((l) => (
            <LinkedFolderRow
              key={l.path}
              link={l}
              onChange={(next) =>
                save(links.map((x) => (x.path === l.path ? next : x)))
              }
              onRemove={() => save(links.filter((x) => x.path !== l.path))}
            />
          ))}
        </ul>
      ) : (
        <p className="setting-muted">No linked folders.</p>
      )}
      <LinkMenu
        project={project}
        linked={links}
        onLink={(path) => void link(path).catch(setError)}
      />
      {!!(error ?? setting.error) && (
        <ErrorBox error={error ?? setting.error} />
      )}
    </div>
  );
}
