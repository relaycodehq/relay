import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  FileQuestion,
  FolderOpen,
  ImageOff,
  LayoutGrid,
  List,
} from "lucide-react";
import {
  imageMime,
  type DirEntry,
  type FileInfo,
} from "../../../shared/project-files";
import { api } from "../../lib/api";
import { formatSize, joinPath } from "../../lib/file-tree";
import { directoryKey } from "./useFileTree";
import { ErrorBox, FileEntryIcon, IconButton, Loading } from "../../ui/ui";
import { EditorPath } from "./EditorPath";
import { revealLabel } from "./FileTree";
import "./file-browser.css";

/** The path across the top of a viewer, in the editor bar's style, with room for actions. */
function FileBar({
  path,
  detail,
  children,
}: {
  path: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="editor-bar">
      <EditorPath path={path}>
        {detail && <span className="editor-bar-state">{detail}</span>}
      </EditorPath>
      {children}
    </div>
  );
}

export function RevealButtons({
  where,
  path,
  external,
  onError,
}: {
  where: string;
  path: string;
  /** A file the system can open in another app. */
  external?: boolean;
  onError: (error: unknown) => void;
}) {
  return (
    <>
      {external && (
        <IconButton
          label="Open with default app"
          onClick={() => void api.openProjectPath(where, path).catch(onError)}
        >
          <ExternalLink size={15} />
        </IconButton>
      )}
      <IconButton
        label={revealLabel}
        onClick={() => void api.revealProjectPath(where, path).catch(onError)}
      >
        <FolderOpen size={15} />
      </IconButton>
    </>
  );
}

const modified = (mtime: number) =>
  new Date(mtime).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

const viewKey = "relay-folder-view";

/** What a folder holds, as a list, or as thumbnails when it's mostly pictures. */
export function FolderView({
  where,
  dir,
  title,
  onOpen,
}: {
  where: string;
  dir: string;
  /** The project's name, for the root. */
  title: string;
  onOpen: (path: string, kind: "file" | "dir") => void;
}) {
  const [error, setError] = useState<unknown>();
  const [chosen, setChosen] = useState<"grid" | "list" | null>(() => {
    const saved = localStorage.getItem(viewKey);
    return saved === "grid" || saved === "list" ? saved : null;
  });
  const listing = useQuery({
    queryKey: directoryKey(where, dir),
    queryFn: () => api.projectDirectory(where, dir),
    refetchInterval: 5000,
    retry: false,
  });
  const entries = listing.data?.entries ?? [];
  const pictures = entries.filter(
    (e) => e.kind === "file" && imageMime(e.name),
  );
  // Without a choice of its own, a folder of screenshots reads better as a grid.
  const grid =
    (chosen ??
      (pictures.length * 2 >= entries.length && pictures.length
        ? "grid"
        : "list")) === "grid";
  const choose = (view: "grid" | "list") => {
    setChosen(view);
    localStorage.setItem(viewKey, view);
  };
  return (
    <section className="folder-view" aria-label="Folder">
      <FileBar
        path={dir || title}
        detail={listing.data ? `${entries.length} items` : undefined}
      >
        <IconButton label="List" active={!grid} onClick={() => choose("list")}>
          <List size={15} />
        </IconButton>
        <IconButton
          label="Thumbnails"
          active={grid}
          onClick={() => choose("grid")}
        >
          <LayoutGrid size={15} />
        </IconButton>
        <span className="divider" />
        <RevealButtons where={where} path={dir} onError={setError} />
      </FileBar>
      {!!(error || listing.error) && (
        <ErrorBox error={error || listing.error} />
      )}
      {listing.isLoading ? (
        <Loading text="Reading the folder…" />
      ) : entries.length === 0 ? (
        <div className="empty project-editor-empty">
          <FolderOpen size={28} />
          <h2>Empty folder</h2>
          <p>Create a file from the tree, or drop something into it.</p>
        </div>
      ) : grid ? (
        <div className="folder-grid">
          {entries.map((entry) => (
            <GridCard
              key={entry.name}
              where={where}
              dir={dir}
              entry={entry}
              onOpen={onOpen}
            />
          ))}
        </div>
      ) : (
        <div className="folder-list" role="list">
          {entries.map((entry) => {
            const path = joinPath(dir, entry.name);
            return (
              <button
                key={entry.name}
                role="listitem"
                disabled={entry.kind === "link"}
                onClick={() =>
                  onOpen(path, entry.kind === "dir" ? "dir" : "file")
                }
              >
                <FileEntryIcon
                  path={entry.name}
                  directory={entry.kind === "dir"}
                />
                <span className={entry.ignored ? "ignored" : ""}>
                  {entry.name}
                </span>
                <small>
                  {entry.kind === "file" ? formatSize(entry.size) : ""}
                </small>
                <small>{modified(entry.mtime)}</small>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function GridCard({
  where,
  dir,
  entry,
  onOpen,
}: {
  where: string;
  dir: string;
  entry: DirEntry;
  onOpen: (path: string, kind: "file" | "dir") => void;
}) {
  const path = joinPath(dir, entry.name);
  const picture = entry.kind === "file" && !!imageMime(entry.name);
  const card = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!picture || !card.current) return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (!seen[0]?.isIntersecting) return;
        observer.disconnect();
        setNear(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [picture]);
  const thumbnail = useQuery({
    queryKey: ["project-thumbnail", where, path, entry.mtime],
    queryFn: () => api.projectThumbnail(where, path),
    enabled: near,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <button
      ref={card}
      className={`folder-card ${entry.ignored ? "ignored" : ""}`}
      disabled={entry.kind === "link"}
      title={entry.name}
      onClick={() => onOpen(path, entry.kind === "dir" ? "dir" : "file")}
    >
      <span className="folder-card-preview">
        {thumbnail.data ? (
          <img src={thumbnail.data} alt="" loading="lazy" />
        ) : thumbnail.isError ? (
          <ImageOff size={22} />
        ) : (
          <FileEntryIcon path={entry.name} directory={entry.kind === "dir"} />
        )}
      </span>
      <span className="folder-card-name">{entry.name}</span>
    </button>
  );
}

/** A picture in the file's own place, on a checkerboard so transparency shows. */
export function ImageFile({ where, info }: { where: string; info: FileInfo }) {
  const [error, setError] = useState<unknown>();
  const [actual, setActual] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const image = useQuery({
    queryKey: ["project-image", where, info.path, info.mtime],
    queryFn: () => api.projectImage(where, info.path),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <section className="image-file" aria-label="Image">
      <FileBar
        path={info.path}
        detail={[
          natural && `${natural.width} × ${natural.height}`,
          formatSize(info.size),
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <IconButton
          label="Copy image"
          disabled={!image.data}
          onClick={() =>
            void api.writeClipboardImage(image.data!).catch(setError)
          }
        >
          <Copy size={15} />
        </IconButton>
        <span className="divider" />
        <RevealButtons
          where={where}
          path={info.path}
          external
          onError={setError}
        />
      </FileBar>
      {!!(error || image.error) && <ErrorBox error={error || image.error} />}
      <div className={`image-file-stage ${actual ? "actual" : ""}`}>
        {image.data ? (
          <img
            src={image.data}
            alt={info.path.split("/").pop()}
            title={actual ? "Fit to window" : "Actual size"}
            onLoad={(e) =>
              setNatural({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
            onClick={() => setActual((v) => !v)}
          />
        ) : (
          !image.error && <Loading text="Opening image…" />
        )}
      </div>
    </section>
  );
}

/** A file that can't be edited here: what it is, and the ways to open it elsewhere. */
export function OtherFile({ where, info }: { where: string; info: FileInfo }) {
  const [error, setError] = useState<unknown>();
  return (
    <section className="other-file" aria-label="File">
      <FileBar path={info.path} detail={formatSize(info.size)}>
        <RevealButtons
          where={where}
          path={info.path}
          external
          onError={setError}
        />
      </FileBar>
      <div className="empty project-editor-empty">
        <FileQuestion size={28} />
        <h2>{info.path.split("/").pop()}</h2>
        <p>{info.reason}</p>
        <div className="other-file-actions">
          <button
            onClick={() =>
              void api.openProjectPath(where, info.path).catch(setError)
            }
          >
            <ExternalLink size={14} /> Open with default app
          </button>
          <button
            onClick={() =>
              void api.revealProjectPath(where, info.path).catch(setError)
            }
          >
            <FolderOpen size={14} /> {revealLabel}
          </button>
        </div>
        {!!error && <ErrorBox error={error} />}
      </div>
    </section>
  );
}
