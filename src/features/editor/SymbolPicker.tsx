import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loading } from "../../ui/ui";
import { usePickerList } from "./usePickerList";
import "./symbol-picker.css";

/** A place to jump to, 1-based. */
export type PickItem = {
  path: string;
  line: number;
  column: number;
  /** The symbol's name, for File Structure. */
  name?: string;
  /** Its kind, in muted text. */
  kind?: string;
  /** Indented under its container. */
  depth?: number;
  /** The line's text, for usages. */
  preview?: string;
  /** Outside the project folder, by its absolute path. */
  outside?: boolean;
};

const nameOf = (path: string) => path.split(/[/\\]/).pop() ?? path;

/** A file's name, with its folder in muted text, above the usages in it. */
function FileHeader({ path }: { path: string }) {
  const name = nameOf(path);
  return (
    <div className="symbol-picker-file" title={path}>
      {name}
      <span>{path.slice(0, -name.length).replace(/[/\\]$/, "")}</span>
    </div>
  );
}

function PickRow({
  item,
  index,
  selected,
  onHover,
  onPick,
}: {
  item: PickItem;
  index: number;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      data-index={index}
      aria-selected={selected}
      className="symbol-picker-row"
      style={item.depth ? { paddingLeft: 12 + item.depth * 14 } : undefined}
      onMouseMove={onHover}
      onClick={onPick}
    >
      {item.name ? (
        <>
          <span className="symbol-picker-name">{item.name}</span>
          {item.kind && <span className="symbol-picker-kind">{item.kind}</span>}
        </>
      ) : (
        <>
          <span className="symbol-picker-line">{item.line}</span>
          <code>{item.preview?.trim() ?? ""}</code>
        </>
      )}
    </button>
  );
}

/**
 * A short list to jump from, as an IDE pops one up at the caret's file:
 * usages of a symbol, its several definitions, or the file's structure.
 * Typing filters it, ↑↓ pick, Enter jumps, Esc goes back to the code.
 */
export function SymbolPicker({
  title,
  items,
  loading = false,
  empty,
  onPick,
  onClose,
}: {
  title: string;
  items: PickItem[] | undefined;
  loading?: boolean;
  /** What it says when nothing was found. */
  empty: string;
  onPick: (item: PickItem) => void;
  onClose: () => void;
}) {
  const { filter, setFilter, selected, setSelected, shown, input, list, onKeyDown } =
    usePickerList(items, onPick, onClose);

  const rows = shown.map((item, index) => {
    // Usages are grouped under their file; a file's structure is all one file.
    const startsFile = !item.name && item.path !== shown[index - 1]?.path;
    return (
      <div key={`${item.path}:${item.line}:${item.column}:${index}`}>
        {startsFile && <FileHeader path={item.path} />}
        <PickRow
          item={item}
          index={index}
          selected={index === selected}
          onHover={() => setSelected(index)}
          onPick={() => onPick(item)}
        />
      </div>
    );
  });
  const waiting = loading && !items;
  const nothingShown = items?.length ? "Nothing matches." : empty;
  return createPortal(
    <div className="symbol-picker-backdrop" onMouseDown={onClose}>
      <div
        className="symbol-picker"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="symbol-picker-head">
          <strong>{title}</strong>
          {items && <span>{items.length === 1 ? "1 place" : `${items.length} places`}</span>}
        </div>
        <input
          ref={input}
          aria-label={`Filter ${title.toLowerCase()}`}
          placeholder="Type to filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="symbol-picker-list" ref={list} role="listbox">
          {waiting && <Loading text="Asking the language server…" />}
          {!waiting && !shown.length && <p className="symbol-picker-empty">{nothingShown}</p>}
          {rows}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The rename field, over the symbol at the caret: Enter renames it
 * everywhere the language server knows of, Esc leaves it.
 */
export function RenameField({
  at,
  initial,
  busy,
  onRename,
  onClose,
}: {
  at: { left: number; top: number; bottom: number };
  initial: string;
  busy: boolean;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return createPortal(
    <div
      className="rename-field"
      style={{ left: Math.max(8, at.left - 6), top: at.bottom + 4 }}
    >
      <input
        ref={input}
        aria-label="New name"
        value={name}
        disabled={busy}
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => !busy && onClose()}
        onKeyDown={(e) => {
          // These keys finish a word being composed in an input method first.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (name.trim() && name !== initial) onRename(name.trim());
            else onClose();
          }
        }}
      />
      <span>{busy ? "Renaming…" : "Enter to rename everywhere"}</span>
    </div>,
    document.body,
  );
}
