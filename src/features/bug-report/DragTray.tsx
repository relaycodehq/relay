import { ArrowDown, Check, Files, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DragTrayFile } from "../../../shared/bug-report";
import { api } from "../../lib/api";
import "./drag-tray.css";

/**
 * The page of the tray Relay floats over GitHub after a report: the files
 * that only go in dragged, ready to drop into the comment box.
 */
export function DragTray() {
  const [files, setFiles] = useState<DragTrayFile[]>([]);
  const [dragged, setDragged] = useState<Set<string>>(new Set());

  useEffect(() => {
    void api.dragTrayFiles().then(setFiles);
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") void api.closeDragTray();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  // The OS takes over the drag, so the page's own one never starts.
  const drag = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    void api.dragTrayFile(id).then(() =>
      setDragged(
        (d) =>
          new Set([...d, ...(id === "all" ? files.map((f) => f.id) : [id])]),
      ),
    );
  };

  return (
    <div className="drag-tray">
      <header>
        <ArrowDown size={14} aria-hidden />
        <span>Drag into the GitHub comment box</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          onClick={() => void api.closeDragTray()}
        >
          <X size={13} />
        </button>
      </header>
      <ul>
        {files.length > 1 && (
          <li className="drag-tile all" draggable onDragStart={drag("all")}>
            <span className="drag-thumb">
              <Files size={30} strokeWidth={1.4} aria-hidden />
            </span>
            <span className="drag-name">All {files.length} files</span>
          </li>
        )}
        {files.map((f) => (
          <li
            key={f.id}
            className="drag-tile"
            draggable
            onDragStart={drag(f.id)}
            title={f.name}
          >
            <span className="drag-thumb">
              <img src={f.thumb} alt="" draggable={false} />
              {dragged.has(f.id) && (
                <Check className="drag-done" size={13} aria-label="Dragged" />
              )}
            </span>
            <span className="drag-name">{f.name}</span>
            <small>{size(f.bytes)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

const size = (bytes: number) =>
  bytes >= 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
