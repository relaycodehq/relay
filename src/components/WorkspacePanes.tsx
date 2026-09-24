import { useCallback, useState, type ReactNode, type DragEvent } from "react";
import { GripVertical, X } from "lucide-react";
import type { PaneId } from "../lib/workspace-panes";
import { IconButton } from "./ui";
import "./workspace-panes.css";

export interface PaneSlots {
  title: HTMLElement | null;
  actions: HTMLElement | null;
}
export const NO_SLOTS: PaneSlots = { title: null, actions: null };

const DRAG_TYPE = "application/x-relay-pane";
const MIN_PANE = 300;

function useDropTarget(
  id: PaneId,
  onMove: (dragged: PaneId, target: PaneId, after: boolean) => void,
) {
  const [side, setSide] = useState<"before" | "after" | null>(null);
  const after = (e: DragEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX > r.left + r.width / 2;
  };
  return {
    side,
    handlers: {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setSide(after(e) ? "after" : "before");
      },
      onDragLeave: () => setSide(null),
      onDrop: (e: DragEvent<HTMLElement>) => {
        const dragged = e.dataTransfer.getData(DRAG_TYPE) as PaneId;
        setSide(null);
        if (!dragged) return;
        e.preventDefault();
        onMove(dragged, id, after(e));
      },
    },
  };
}

function dragSource(id: PaneId) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.setData(DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = "move";
    },
  };
}

/** Header toggles: click to show or hide a pane, drag to reorder the workspace. */
export function PaneToggles({
  panes,
  onToggle,
  onMove,
}: {
  panes: {
    id: PaneId;
    label: string;
    icon: ReactNode;
    open: boolean;
    disabled?: boolean;
    /** Lines changed, shown after the label; hidden when there are none. */
    stat?: { additions: number; deletions: number };
  }[];
  onToggle: (id: PaneId) => void;
  onMove: (dragged: PaneId, target: PaneId, after: boolean) => void;
}) {
  return (
    <div className="pane-toggles" role="group" aria-label="Workspace panes">
      {panes.map((p) => (
        <PaneToggle key={p.id} pane={p} onToggle={onToggle} onMove={onMove} />
      ))}
    </div>
  );
}
function PaneToggle({
  pane,
  onToggle,
  onMove,
}: {
  pane: {
    id: PaneId;
    label: string;
    icon: ReactNode;
    open: boolean;
    disabled?: boolean;
    /** Lines changed, shown after the label; hidden when there are none. */
    stat?: { additions: number; deletions: number };
  };
  onToggle: (id: PaneId) => void;
  onMove: (dragged: PaneId, target: PaneId, after: boolean) => void;
}) {
  const drop = useDropTarget(pane.id, onMove);
  return (
    <button
      type="button"
      className={`pane-toggle ${pane.open ? "active" : ""} ${drop.side ? `drop-${drop.side}` : ""}`}
      aria-pressed={pane.open}
      disabled={pane.disabled}
      title={`${pane.open ? "Hide" : "Show"} ${pane.label.toLowerCase()} · drag to reorder`}
      onClick={() => onToggle(pane.id)}
      {...dragSource(pane.id)}
      {...drop.handlers}
    >
      {pane.icon}
      <span>{pane.label}</span>
      {!!(pane.stat?.additions || pane.stat?.deletions) && (
        <span
          className="pane-toggle-stat"
          aria-label={`${pane.stat.additions} lines added, ${pane.stat.deletions} removed`}
        >
          <span className="pane-toggle-add">+{pane.stat.additions}</span>
          <span className="pane-toggle-del">−{pane.stat.deletions}</span>
        </span>
      )}
    </button>
  );
}

export function Pane({
  id,
  order,
  weight,
  grow,
  open,
  previous,
  onResize,
  onMove,
  className = "",
  label,
  children,
}: {
  id: PaneId;
  order: number;
  weight: number;
  /** Share of the row; visible panes' shares add up to 1 so they always fill it. */
  grow: number;
  open: boolean;
  /** The visible pane immediately before this one, if any. */
  previous?: { id: PaneId; weight: number };
  onResize: (weights: Partial<Record<PaneId, number>>) => void;
  onMove: (dragged: PaneId, target: PaneId, after: boolean) => void;
  className?: string;
  label: string;
  children: ReactNode;
}) {
  const drop = useDropTarget(id, onMove);
  return (
    <section
      className={`workspace-pane ${className} ${drop.side ? `drop-${drop.side}` : ""}`}
      data-pane={id}
      aria-label={label}
      hidden={!open}
      style={{ order, flexGrow: grow }}
      {...drop.handlers}
    >
      {previous && (
        <PaneSplitter
          left={previous}
          right={{ id, weight }}
          onResize={onResize}
        />
      )}
      {children}
    </section>
  );
}

function PaneSplitter({
  left,
  right,
  onResize,
}: {
  left: { id: PaneId; weight: number };
  right: { id: PaneId; weight: number };
  onResize: (weights: Partial<Record<PaneId, number>>) => void;
}) {
  const resizeBy = (leftWidth: number, total: number) => {
    const share = left.weight + right.weight;
    const next = Math.max(MIN_PANE, Math.min(total - MIN_PANE, leftWidth));
    onResize({
      [left.id]: (next / total) * share,
      [right.id]: ((total - next) / total) * share,
    });
  };
  const widths = (element: HTMLElement) => {
    const pane = element.parentElement!;
    const before = pane.parentElement!.querySelector<HTMLElement>(
      `[data-pane="${left.id}"]`,
    )!;
    const l = before.getBoundingClientRect().width;
    return { l, total: l + pane.getBoundingClientRect().width };
  };
  return (
    <div
      className="pane-splitter"
      role="separator"
      aria-label="Resize panes"
      aria-orientation="vertical"
      tabIndex={0}
      onDoubleClick={() => onResize({ [left.id]: 1, [right.id]: 1 })}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const { l, total } = widths(e.currentTarget);
        resizeBy(l + (e.key === "ArrowLeft" ? -20 : 20), total);
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        const element = e.currentTarget;
        const start = e.clientX,
          { l, total } = widths(element);
        element.setPointerCapture(e.pointerId);
        element.classList.add("dragging");
        const move = (event: PointerEvent) =>
          resizeBy(l + event.clientX - start, total);
        const stop = () => {
          element.classList.remove("dragging");
          element.removeEventListener("pointermove", move);
          element.removeEventListener("pointerup", stop);
          element.removeEventListener("pointercancel", stop);
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", stop);
        element.addEventListener("pointercancel", stop);
      }}
    />
  );
}

/**
 * One slim row per pane. Content components portal their own controls into
 * the title and action slots, so a pane never stacks a second toolbar.
 */
export function PaneHeader({
  id,
  icon,
  title,
  onClose,
  closeDisabled,
  onSlots,
  children,
}: {
  id: PaneId;
  icon: ReactNode;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
  onSlots?: (update: (slots: PaneSlots) => PaneSlots) => void;
  children?: ReactNode;
}) {
  const titleRef = useCallback(
      (title: HTMLElement | null) => onSlots?.((s) => ({ ...s, title })),
      [onSlots],
    ),
    actionsRef = useCallback(
      (actions: HTMLElement | null) => onSlots?.((s) => ({ ...s, actions })),
      [onSlots],
    );
  return (
    <header className="pane-header">
      <div
        className="pane-header-title"
        {...dragSource(id)}
        title="Drag to reorder"
      >
        <GripVertical className="pane-grip" size={13} />
        {icon}
        <strong>{title}</strong>
        <div className="pane-title-slot" ref={titleRef} />
      </div>
      <div className="pane-header-actions" ref={actionsRef} />
      {children}
      <IconButton
        label={`Close ${title.toLowerCase()}`}
        disabled={closeDisabled}
        onClick={onClose}
      >
        <X size={15} />
      </IconButton>
    </header>
  );
}
