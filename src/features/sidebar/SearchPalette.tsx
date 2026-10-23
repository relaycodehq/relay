import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { ChatSummary, Project } from "../../../shared/projects";
import { relativeDate } from "../../lib/relative-date";
import { useReturnFocus } from "../../lib/focus-return";
import { useBackdropClose } from "../../lib/backdrop-close";
import { ProjectBadge } from "../projects/ProjectBadge";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { ThreadRef } from "./ThreadRef";
import "../../ui/palette.css";

const LISTED = 100;

/** `title` with the first `query` in it marked. */
function Marked({ title, query }: { title: string; query: string }) {
  const at = query ? title.toLowerCase().indexOf(query) : -1;
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <mark>{title.slice(at, at + query.length)}</mark>
      {title.slice(at + query.length)}
    </>
  );
}

/**
 * Finds a thread by its title, project, model or branch, across every project,
 * whatever the sidebar's filter hides. Empty, it lists the latest threads.
 */
export function SearchPalette({
  threads,
  projects,
  onOpen,
  onClose,
}: {
  /** Newest first. */
  threads: ChatSummary[];
  projects: Map<string, Project>;
  onOpen: (chat: ChatSummary) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  useReturnFocus();
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
  }, []);

  const query = text.trim().toLowerCase();
  const projectName = (c: ChatSummary) => {
    const p = projects.get(c.projectId);
    return p?.scratch ? "Scratchpad" : (p?.name ?? "");
  };
  const hasRef = (c: ChatSummary) =>
    !!(c.branch || c.commit) && !projects.get(c.projectId)?.scratch;
  const results = (
    query
      ? threads.filter((c) =>
          `${c.title} ${projectName(c)} ${c.model ?? ""} ${c.branch ?? ""}`
            .toLowerCase()
            .includes(query),
        )
      : threads
  ).slice(0, LISTED);
  const at = Math.min(active, results.length - 1);
  useEffect(() => {
    list.current
      ?.querySelector("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const open = (c: ChatSummary | undefined) => {
    if (!c) return;
    onClose();
    onOpen(c);
  };
  function onKeyDown(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length)
        setActive(
          (at + (e.key === "ArrowDown" ? 1 : -1) + results.length) %
            results.length,
        );
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(results[at]);
    }
  }

  const backdropClose = useBackdropClose(onClose);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal palette"
      aria-label="Search threads"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      {...backdropClose}
    >
      <div className="headline-project-search palette-search">
        <Search size={15} />
        <input
          ref={input}
          aria-label="Search threads"
          placeholder="Search threads…"
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        ref={list}
        className="palette-body"
        role="listbox"
        aria-label="Threads"
      >
        {results.length > 0 && (
          <div className="composer-menu-label">
            {query ? "Threads" : "Recent"}
          </div>
        )}
        {results.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={i === at}
            className="headline-project-row palette-row"
            data-highlighted={i === at ? "" : undefined}
            onMouseMove={() => setActive(i)}
            onClick={() => open(c)}
          >
            <ProjectBadge project={projects.get(c.projectId)} />
            <span className="headline-project-row-label">
              <strong>
                <Marked title={c.title} query={query} />
              </strong>
              <small className="palette-thread-meta">
                <span>{projectName(c)}</span>
                {hasRef(c) && <ThreadRef chat={c} branchIcon />}
              </small>
            </span>
            <span className="palette-thread-side">
              {c.provider && (
                <span className="palette-thread-model">
                  <ProviderIcon provider={c.provider} />
                  {c.model}
                </span>
              )}
              <em>{relativeDate(new Date(c.updated).toISOString())}</em>
            </span>
          </button>
        ))}
        {!results.length && (
          <p className="headline-project-empty">
            {query ? "No matching threads." : "No threads yet."}
          </p>
        )}
      </div>
      <div className="palette-foot">
        <span>↑↓ to pick · ↵ to open</span>
        <span>esc to close</span>
      </div>
    </dialog>,
    document.body,
  );
}
