import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, FileQuestion, FolderOpen } from "lucide-react";
import { type FileInfo } from "../../../shared/project-files";
import { api } from "../../lib/api";
import { formatSize } from "../../lib/file-tree";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { EditorPath } from "../../ui/EditorPath";
import { revealLabel } from "../../lib/mod-key";
import { OpenWithButton } from "./OpenWithButton";
import "./file-browser.css";

/** The path under a viewer, in the editor's status line style, with its actions at the end. */
export function FileBar({
  lead,
  path,
  detail,
  children,
}: {
  /** Before the path, like the file list's toggle. */
  lead?: ReactNode;
  path: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="editor-bar">
      {lead}
      <EditorPath path={path}>
        {detail && <span className="editor-bar-state">{detail}</span>}
      </EditorPath>
      <span className="editor-bar-gap" />
      {children}
    </div>
  );
}

/** A picture in the file's own place, on a checkerboard so transparency shows. */
export function ImageFile({
  active,
  where,
  info,
  lead,
  shownPath = info.path,
  actions,
}: {
  active: boolean;
  where: string;
  info: FileInfo;
  lead?: ReactNode;
  /** What the bar shows instead of the path, like a file's full path outside the project. */
  shownPath?: string;
  /** First in the bar, before its own buttons. */
  actions?: ReactNode;
}) {
  const [error, setError] = useState<unknown>();
  const [actual, setActual] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number }>();
  const image = useQuery({
    queryKey: ["project-image", where, info.path, info.mtime],
    queryFn: () => api.projectImage(where, info.path),
    enabled: active,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <section className="image-file" aria-label="Image">
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
      <FileBar
        lead={lead}
        path={shownPath}
        detail={[
          natural && `${natural.width} × ${natural.height}`,
          formatSize(info.size),
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {actions}
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
        <OpenWithButton
          where={where}
          path={info.path}
          external
          onError={setError}
        />
      </FileBar>
    </section>
  );
}

/** A video in the file's own place, played as it streams from disk. */
export function VideoFile({
  active,
  where,
  info,
  lead,
  shownPath = info.path,
  actions,
}: {
  active: boolean;
  where: string;
  info: FileInfo;
  lead?: ReactNode;
  /** What the bar shows instead of the path, like a file's full path outside the project. */
  shownPath?: string;
  /** First in the bar, before its own buttons. */
  actions?: ReactNode;
}) {
  const [error, setError] = useState<unknown>();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const video = useQuery({
    queryKey: ["project-video", where, info.path, info.mtime],
    queryFn: () => api.projectVideo(where, info.path),
    enabled: active,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <section className="image-file" aria-label="Video">
      {!!(error || video.error) && <ErrorBox error={error || video.error} />}
      <div className="image-file-stage">
        {video.data ? (
          <video
            src={video.data}
            controls
            onLoadedMetadata={(e) =>
              setSize({
                width: e.currentTarget.videoWidth,
                height: e.currentTarget.videoHeight,
              })
            }
            onError={() =>
              setError(
                new Error("This video won't play here; try the default app."),
              )
            }
          />
        ) : (
          !video.error && <Loading text="Opening video…" />
        )}
      </div>
      <FileBar
        lead={lead}
        path={shownPath}
        detail={[
          size && `${size.width} × ${size.height}`,
          formatSize(info.size),
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {actions}
        <OpenWithButton
          where={where}
          path={info.path}
          external
          onError={setError}
        />
      </FileBar>
    </section>
  );
}

/** A file that can't be edited here: what it is, and the ways to open it elsewhere. */
export function OtherFile({
  where,
  info,
  lead,
  shownPath = info.path,
}: {
  where: string;
  info: FileInfo;
  lead?: ReactNode;
  /** What the bar shows instead of the path, like a file's full path outside the project. */
  shownPath?: string;
}) {
  const [error, setError] = useState<unknown>();
  return (
    <section className="other-file" aria-label="File">
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
      <FileBar lead={lead} path={shownPath} detail={formatSize(info.size)}>
        <OpenWithButton
          where={where}
          path={info.path}
          external
          onError={setError}
        />
      </FileBar>
    </section>
  );
}
