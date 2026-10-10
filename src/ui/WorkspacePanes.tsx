import {
  useCallback,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { PaneId } from "../lib/workspace-panes";
import { IconButton } from "./ui";
import "./workspace-panes.css";
import { Splitter } from "./Splitter";

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

/**
 * Makes a pane's whole header drag the pane. Text fields portaled into it
 * still select text: the header lets go of dragging while one is pressed.
 */
export function paneDrag(id: PaneId) {
  return {
    ...dragSource(id),
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.draggable = !(e.target as Element).closest(
        "input, textarea, select, [contenteditable]",
      );
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
    /** Holds something new the user hasn't looked at: a dot. */
    unseen?: boolean;
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
    unseen?: boolean;
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
      title={`${pane.open ? "Hide" : "Show"} ${pane.label.toLowerCase()}${pane.unseen ? " · something new" : ""} · drag to reorder`}
      onClick={() => onToggle(pane.id)}
      {...dragSource(pane.id)}
      {...drop.handlers}
    >
      {pane.icon}
      <span className="pane-toggle-label">{pane.label}</span>
      {pane.unseen && <span className="unseen-dot" aria-hidden="true" />}
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
    <>
      {/* A sibling, not a child: the pane clips its overflow, which cut the
          splitter's left half off. Same order and earlier in the DOM puts it
          right before its pane. */}
      {previous && (
        <PaneSplitter
          order={order}
          left={previous}
          right={{ id, weight }}
          onResize={onResize}
        />
      )}
      <section
        className={`workspace-pane ${className} ${drop.side ? `drop-${drop.side}` : ""}`}
        data-pane={id}
        aria-label={label}
        hidden={!open}
        style={{ order, flexGrow: grow }}
        {...drop.handlers}
      >
        {children}
      </section>
    </>
  );
}

function PaneSplitter({
  order,
  left,
  right,
  onResize,
}: {
  order: number;
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
    const pane = element.nextElementSibling!;
    const before = element.parentElement!.querySelector<HTMLElement>(
      `[data-pane="${left.id}"]`,
    )!;
    const l = before.getBoundingClientRect().width;
    return { l, total: l + pane.getBoundingClientRect().width };
  };
  return (
    <Splitter
      className="pane-splitter"
      label="Resize panes"
      step={20}
      style={{ order }}
      begin={(handle) => {
        const { l, total } = widths(handle);
        return (delta) => resizeBy(l + delta, total);
      }}
      onReset={() => onResize({ [left.id]: 1, [right.id]: 1 })}
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
  detail,
}: {
  id: PaneId;
  icon: ReactNode;
  title: string;
  /** Muted text after the title, like which folder the pane shows. */
  detail?: { text: string; title?: string };
  onClose: () => void;
  closeDisabled?: boolean;
  onSlots?: (update: (slots: PaneSlots) => PaneSlots) => void;
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
    <header className="pane-header" {...paneDrag(id)}>
      <div className="pane-header-title">
        {icon}
        <strong>{title}</strong>
        {detail && (
          <small className="pane-header-detail" title={detail.title}>
            {detail.text}
          </small>
        )}
        <div className="pane-title-slot" ref={titleRef} />
      </div>
      <div className="pane-header-actions" ref={actionsRef} />
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
