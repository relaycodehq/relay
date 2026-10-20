import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronRight,
  File,
  Folder,
  FolderGit2,
  FolderOpen,
  Search,
} from "lucide-react";
import type { PairedComputer } from "../../../shared/handoff";
import { linkName, type Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { fileManager } from "../../lib/mod-key";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import { ErrorBox } from "../../ui/ui";
import { localProjectAt } from "./related";
import { folderLabel, fromHomeFolder, parentFolder } from "./folder-path";

export function ProjectFolders({
  projects,
  computer,
  initialFolder,
  home,
  busy,
  onPick,
  onNative,
  children,
}: {
  projects: readonly Project[];
  computer?: PairedComputer;
  initialFolder?: string;
  home?: string;
  busy: boolean;
  onPick: (path: string) => void;
  onNative: () => void;
  children?: ReactNode;
}) {
  const [path, setPath] = useState(initialFolder ?? "~");
  const [typed, setTyped] = useState(folderLabel(path, home));
  const [selected, setSelected] = useState<string>();
  const [filter, setFilter] = useState("");
  const seeded = useRef(!!initialFolder);
  useEffect(() => {
    if (!seeded.current && initialFolder) {
      seeded.current = true;
      setPath(initialFolder);
      setTyped(folderLabel(initialFolder, home));
    }
  }, [initialFolder, home]);
  const listing = useQuery({
    queryKey: ["project-folders", computer?.id, path],
    queryFn: async () =>
      computer
        ? api.computerFolders(computer.id, path)
        : { folders: await api.listFolders(path), home, dir: path },
    retry: false,
    staleTime: 10_000,
  });
  const folders = listing.data?.folders ?? [];
  const chosen = folders.find((f) => f.path === selected);
  const chosenPath = chosen?.path ?? listing.data?.dir ?? path;
  const label = folderLabel(chosenPath, listing.data?.home ?? home);
  const name = chosen?.name ?? (label === "~" ? "Home" : linkName(label));
  const preview = useQuery({
    queryKey: ["folder-preview", computer?.id, chosenPath],
    queryFn: () => api.folderPreview(chosenPath, computer?.id),
    enabled: listing.isSuccess,
    retry: false,
    staleTime: 10_000,
  });
  const known = computer
    ? projects.find(
        (p) =>
          p.computer?.id === computer.id &&
          folderLabel(p.path, listing.data?.home) === label,
      )
    : localProjectAt(projects, chosenPath);
  const filtered = folders.filter((f) =>
    f.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const here = fromHomeFolder(
    listing.data?.dir ?? path,
    listing.data?.home ?? home,
  );
  const parent = parentFolder(here);
  function browse(next: string) {
    seeded.current = true;
    setPath(next);
    setTyped(folderLabel(next, listing.data?.home ?? home));
    setSelected(undefined);
    setFilter("");
  }
  return (
    <>
      <div className="add-folder-path">
        <button
          type="button"
          className="icon-button"
          aria-label="Parent folder"
          disabled={busy || parent === here}
          onClick={() => browse(parent)}
        >
          <ArrowUp size={15} />
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && typed.trim()) browse(typed.trim());
          }}
        >
          <FolderOpen size={15} />
          <input
            aria-label="Folder path"
            value={typed}
            onChange={(e) => {
              seeded.current = true;
              setTyped(e.target.value);
            }}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
          />
          <button disabled={busy || !typed.trim()}>Go</button>
        </form>
      </div>
      <div className="add-folder-browser">
        <div className="add-folder-list">
          <div className="headline-project-search">
            <Search size={14} />
            <input
              aria-label="Filter folders"
              placeholder="Filter folders…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="add-folder-rows">
            {filtered.map((f) => (
              <div
                className={`add-folder-row${selected === f.path ? " selected" : ""}`}
                key={f.path}
              >
                <button
                  type="button"
                  className="headline-project-row palette-row"
                  aria-pressed={selected === f.path}
                  disabled={busy}
                  onClick={() => {
                    seeded.current = true;
                    setSelected(f.path);
                  }}
                  onDoubleClick={() => browse(f.path)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight") {
                      e.preventDefault();
                      browse(f.path);
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onPick(f.path);
                    }
                  }}
                >
                  {f.repository ? (
                    <FolderGit2 size={17} />
                  ) : (
                    <Folder size={17} />
                  )}
                  <span className="headline-project-row-label">
                    <strong>{f.name}</strong>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Browse inside ${f.name}`}
                  disabled={busy}
                  onClick={() => browse(f.path)}
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            ))}
            {!filtered.length && !listing.error && (
              <p className="headline-project-empty">
                {listing.isPending
                  ? "Loading folders…"
                  : filter
                    ? "No matching folders."
                    : "No subfolders."}
              </p>
            )}
            {!!listing.error && (
              <>
                <ErrorBox error={listing.error} />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void listing.refetch()}
                >
                  Try again
                </button>
              </>
            )}
          </div>
        </div>
        <div className="add-folder-preview">
          <div className="add-folder-preview-heading">
            {chosen?.repository ? (
              <FolderGit2 size={28} />
            ) : (
              <FolderOpen size={28} />
            )}
            <strong>{name}</strong>
            <MiddleTruncate text={label} kind="path" />
            <small>
              {known
                ? "Already in Relay"
                : chosen?.repository
                  ? "Git repository"
                  : "Folder"}
            </small>
          </div>
          <div
            className="add-folder-contents"
            aria-label={`Contents of ${name}`}
          >
            {preview.data ? (
              <>
                <ul>
                  {preview.data.entries.map((entry) => (
                    <li key={entry.name} title={entry.name}>
                      {entry.directory ? (
                        <Folder size={13} />
                      ) : (
                        <File size={13} />
                      )}
                      <span>{entry.name}</span>
                    </li>
                  ))}
                </ul>
                {preview.data.remaining > 0 && (
                  <small>+{preview.data.remaining} more</small>
                )}
                {!preview.data.entries.length && (
                  <small>No visible files</small>
                )}
              </>
            ) : (
              <small>
                {preview.isError ? "Preview unavailable" : "Loading preview…"}
              </small>
            )}
          </div>
        </div>
      </div>
      <div className="add-folder-messages">{children}</div>
      <div className="add-project-footer">
        {!computer && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={onNative}
          >
            Choose in {fileManager}…
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || !listing.isSuccess}
          onClick={() => onPick(chosenPath)}
        >
          {busy ? "Opening…" : `Open ${name}`}
        </button>
      </div>
    </>
  );
}
