import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useBackdropClose } from "../../lib/backdrop-close";
import { modeLabel, modePlaceholder } from "./palette-modes";
import { PaletteResults } from "./PaletteResults";
import type { SearchFlags } from "./search-options";
import { SearchToggles } from "./SearchToggles";
import type { OpenTarget, SearchMode, SearchSymbol } from "./types";
import { usePaletteSession } from "./usePaletteSession";
import "../../ui/palette.css";
import "./project-search.css";

interface SearchEverywhereProps {
  /** The workspace to search. */
  where: string;
  open: boolean;
  initialMode?: SearchMode;
  /** Paths to list before anything is typed, most recent first. */
  recent: string[];
  /** The open file, which `:42` alone jumps within. */
  activePath?: string;
  /** Workspace symbols matching a query, from the language servers; the Symbols section shows only with it. */
  symbols?: (query: string) => Promise<SearchSymbol[]>;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
}

/**
 * Search Everywhere: one box over the project's files (fuzzy, camel humps,
 * `Name:42` to jump to a line), the text in them, and the symbols the host
 * knows. The host decides when it opens and what a pick does.
 */
export function SearchEverywhere(props: SearchEverywhereProps) {
  return props.open ? <Palette {...props} /> : null;
}

function PaletteTabs(props: {
  modes: SearchMode[];
  mode: SearchMode;
  onPick: (mode: SearchMode) => void;
}) {
  return (
    <div className="ps-tabs" role="tablist" aria-label="Search in">
      {props.modes.map((mode) => (
        <button
          key={mode}
          type="button"
          role="tab"
          className="ps-tab"
          aria-selected={mode === props.mode}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => props.onPick(mode)}
        >
          {modeLabel(mode)}
        </button>
      ))}
    </div>
  );
}

function PaletteFoot(props: { note: { text: string; problem: boolean } }) {
  const { text, problem } = props.note;
  return (
    <div className="palette-foot">
      <span className="ps-foot-note" data-problem={problem ? "" : undefined}>
        {text}
      </span>
      <span>esc to close</span>
    </div>
  );
}

function PaletteDialog(props: { onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropClose = useBackdropClose(props.onClose);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="modal palette ps-palette"
      aria-label="Search everywhere"
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
      {...backdropClose}
    >
      {props.children}
    </dialog>,
    document.body,
  );
}

function PaletteInput(props: {
  inputRef: Ref<HTMLInputElement>;
  mode: SearchMode;
  text: string;
  flags: SearchFlags;
  toggle: Record<keyof SearchFlags, () => void>;
  onText: (text: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  return (
    <div className="ps-input">
      <Search size={15} />
      <input
        ref={props.inputRef}
        aria-label="Search everywhere"
        placeholder={modePlaceholder(props.mode)}
        value={props.text}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => props.onText(e.target.value)}
        onKeyDown={props.onKeyDown}
      />
      {props.mode === "text" && (
        <SearchToggles flags={props.flags} toggle={props.toggle} />
      )}
    </div>
  );
}

function Palette(props: SearchEverywhereProps) {
  const session = usePaletteSession(props);
  const { results } = session;
  return (
    <PaletteDialog onClose={props.onClose}>
      <PaletteTabs modes={session.modes} mode={session.mode} onPick={session.switchTo} />
      <PaletteInput
        inputRef={session.input}
        mode={session.mode}
        text={session.text}
        flags={session.flags}
        toggle={session.toggle}
        onText={session.changeText}
        onKeyDown={session.onKeyDown}
      />
      <PaletteResults
        listRef={session.list}
        sections={results.sections}
        activeIndex={session.activeIndex}
        indexing={results.indexing}
        fileListError={results.fileListError}
        nothingFoundFor={results.nothingFound ? session.text.trim() : undefined}
        onHover={session.setActive}
        onChoose={session.choose}
        onShowMore={session.switchTo}
      />
      <PaletteFoot note={results.note} />
    </PaletteDialog>
  );
}
