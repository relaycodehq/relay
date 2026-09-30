import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ArrowUp, MoveHorizontal, RotateCcw } from "lucide-react";
import {
  canHide,
  defaultToolbar,
  hideItem,
  isDefaultToolbar,
  placeSlot,
  setComposerToolbar,
  showItem,
  stepSlot,
  toolbarNames,
  useComposerToolbar,
  type ToolbarSlot,
} from "../lib/composer-toolbar";
import { ComposerToolbar } from "./ComposerToolbar";
import { useSampleControls } from "./ComposerToolbarSample";
import "./composer-toolbar.css";

/**
 * The composer as chats show it, whose controls drag along the bar. The gap
 * drags too, choosing what sits on the right; the tray below holds the
 * hidden ones.
 */
export function ComposerToolbarSettings() {
  const layout = useComposerToolbar();
  const controls = useSampleControls();
  const [dragging, setDragging] = useDragging();
  const [over, setOver] = useState(false);
  const tools = useFitOneLine();
  const hideable =
    !!dragging && dragging !== "gap" && canHide(dragging) ? dragging : null;
  const save = setComposerToolbar;

  const start = (slot: ToolbarSlot) => (e: DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", slot);
    setDragging(slot);
  };
  const slotKeys = (slot: ToolbarSlot) => (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") save(stepSlot(layout, slot, -1));
    else if (e.key === "ArrowRight") save(stepSlot(layout, slot, 1));
    else if (slot !== "gap" && (e.key === "Backspace" || e.key === "Delete"))
      save(hideItem(layout, slot));
    else return;
    e.preventDefault();
  };
  const draggable = (slot: ToolbarSlot, node: ReactNode) => {
    const gap = slot === "gap";
    const name = gap ? "Gap" : toolbarNames[slot];
    return (
      <span
        className={gap ? "toolbar-edit-gap" : "toolbar-edit-item"}
        draggable
        tabIndex={0}
        role="button"
        aria-label={gap ? "Gap: everything after it sits on the right" : name}
        aria-keyshortcuts={
          gap ? "ArrowLeft ArrowRight" : "ArrowLeft ArrowRight Delete"
        }
        title={
          gap
            ? "Drag to choose what sits on the right"
            : `${name} · drag to move, or below to hide`
        }
        data-dragging={dragging === slot || undefined}
        onDragStart={start(slot)}
        onDragOver={(e) => {
          if (!dragging || dragging === slot) return;
          e.preventDefault();
          const box = e.currentTarget.getBoundingClientRect();
          const after = e.clientX > box.left + box.width / 2;
          save(placeSlot(layout, dragging, slot, after));
        }}
        onKeyDown={slotKeys(slot)}
      >
        {gap ? (
          <MoveHorizontal size={13} aria-hidden />
        ) : (
          <span className="toolbar-edit-control" inert>
            {node}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="toolbar-edit">
      <div className="project-composer">
        <p className="toolbar-edit-prompt">
          Ask about the code, plan a change, or build something…
        </p>
        <div
          ref={tools}
          className="composer-tools"
          role="group"
          aria-label="Composer toolbar order"
          onDrop={(e) => e.preventDefault()}
        >
          <ComposerToolbar
            layout={layout}
            controls={controls}
            wrap={draggable}
          />
          <button
            type="button"
            className="primary send-message"
            title="Send stays last"
            inert
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
      <div
        className="composer-tools toolbar-edit-tray"
        aria-label="Hidden controls"
        data-armed={hideable ? "" : undefined}
        data-over={(over && hideable) || undefined}
        onDragOver={(e) => {
          if (!hideable) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (hideable) save(hideItem(layout, hideable));
        }}
      >
        {layout.hidden.length === 0 ? (
          <span className="toolbar-edit-empty">
            {hideable ? "Drop here to hide" : "Nothing hidden"}
          </span>
        ) : (
          layout.hidden.map((item) => (
            <span
              key={item}
              className="toolbar-edit-hidden"
              draggable
              tabIndex={0}
              role="button"
              title="Drag back onto the bar, or press Enter"
              onDragStart={start(item)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save(showItem(layout, item));
              }}
              onDoubleClick={() => save(showItem(layout, item))}
            >
              <span className="toolbar-edit-control" inert>
                {controls[item]}
              </span>
              {toolbarNames[item]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

export function ComposerToolbarReset() {
  const layout = useComposerToolbar();
  return (
    <button
      type="button"
      className="ghost toolbar-edit-reset"
      disabled={isDefaultToolbar(layout)}
      onClick={() => setComposerToolbar(defaultToolbar)}
    >
      <RotateCcw size={13} aria-hidden />
      Reset
    </button>
  );
}

/**
 * The slot being dragged. Showing or hiding one unmounts the element the drag
 * began on, which then never gets its dragend, so the window ends it too.
 */
function useDragging() {
  const [dragging, setDragging] = useState<ToolbarSlot>();
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(undefined);
    const events = ["dragend", "drop", "mousemove"] as const;
    for (const event of events) window.addEventListener(event, stop);
    return () => {
      for (const event of events) window.removeEventListener(event, stop);
    };
  }, [dragging]);
  return [dragging, setDragging] as const;
}

/**
 * Zooms the bar out until it fits on one line. Settings is narrower than
 * most chats, and a wrapped bar wouldn't show the order it will have.
 */
function useFitOneLine() {
  const ref = useRef<HTMLDivElement>(null);
  const fit = () => {
    const el = ref.current!;
    el.style.zoom = "";
    const over = el.scrollWidth / el.clientWidth;
    if (over > 1) el.style.zoom = String(1 / over);
  };
  // Any render can change a control's width, e.g. once model names load.
  useLayoutEffect(fit);
  useEffect(() => {
    const observer = new ResizeObserver(fit);
    observer.observe(ref.current!.parentElement!);
    return () => observer.disconnect();
  }, []);
  return ref;
}
