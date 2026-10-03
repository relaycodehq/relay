import { Info } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ChatMessage } from "../../../shared/projects";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { MessageAgentName } from "./MessageAgentName";
import { RichText } from "../../ui/ui";

/** The line where a session was compacted; its (i) shows the summary the agent kept. */
export function CompactionRow({
  message: m,
  projectRoot,
  onOpenFile,
}: {
  message: ChatMessage;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // Clicked open, it stays until Escape or a click elsewhere, so it can be read and scrolled.
  const [pinned, setPinned] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const summary = m.status === "complete" ? m.compactSummary : undefined;
  const hover = (on: boolean) => {
    clearTimeout(closing.current);
    if (on) setOpen(true);
    // A beat to cross the gap between the icon and the popover.
    else closing.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  const shown = !!summary && (open || pinned);
  useEffect(() => {
    if (!pinned) return;
    const close = () => {
      setPinned(false);
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!row.current?.contains(target) && !popover.current?.contains(target))
        close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [pinned]);
  return (
    <div
      ref={row}
      className="context-compaction"
      data-message-id={m.id}
      data-status={m.status}
      role="status"
    >
      <span>
        {m.status === "streaming"
          ? "Compacting context…"
          : m.status === "complete"
            ? "Context compacted"
            : m.status === "cancelled"
              ? "Compaction stopped"
              : (m.error ?? "Compaction failed")}
      </span>
      {summary && (
        <button
          type="button"
          className="compact-summary-trigger"
          aria-label="Show what the context was compacted to"
          aria-expanded={shown}
          onMouseEnter={() => hover(true)}
          onMouseLeave={() => hover(false)}
          onFocus={() => hover(true)}
          onBlur={() => !pinned && hover(false)}
          onClick={() => setPinned((v) => !v)}
        >
          <Info size={12} />
        </button>
      )}
      {shown &&
        row.current &&
        createPortal(
          <SummaryPopover
            box={popover}
            anchor={row.current}
            onHover={hover}
            message={m}
            summary={summary}
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
          />,
          document.body,
        )}
    </div>
  );
}

const gap = 6;
const margin = 12;

/** As wide as the thread, on whichever side of the row has more room. */
function SummaryPopover({
  box,
  anchor,
  onHover,
  message: m,
  summary,
  projectRoot,
  onOpenFile,
}: {
  box: RefObject<HTMLDivElement | null>;
  anchor: HTMLElement;
  onHover: (on: boolean) => void;
  message: ChatMessage;
  summary: string;
  projectRoot: string;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  const [place, setPlace] = useState<CSSProperties>();
  useLayoutEffect(() => {
    const row = anchor.getBoundingClientRect();
    const below = window.innerHeight - row.bottom;
    const width = Math.min(row.width, window.innerWidth - 2 * margin);
    const left = Math.max(margin, row.left + (row.width - width) / 2);
    setPlace(
      below >= row.top
        ? {
            left,
            width,
            top: row.bottom + gap,
            maxHeight: below - gap - margin,
          }
        : {
            left,
            width,
            bottom: window.innerHeight - row.top + gap,
            maxHeight: row.top - gap - margin,
          },
    );
  }, [anchor]);
  return (
    <div
      ref={box}
      className="compact-summary"
      role="dialog"
      aria-label="Compacted context"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={place ?? { visibility: "hidden", left: 0, top: 0 }}
    >
      <article className="project-message assistant">
        <header>
          <MessageAgentName provider={m.provider} model={m.model} />
          <span className="muted">kept this after compacting</span>
        </header>
        <RichText
          text={summary}
          projectRoot={projectRoot}
          onOpenFile={onOpenFile}
        />
      </article>
    </div>
  );
}
