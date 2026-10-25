import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useReturnFocus } from "../../lib/focus-return";
import { modeAfter, modesFor, startingMode } from "./palette-modes";
import type { Row } from "./palette-sections";
import { useSearchFlags } from "./search-options";
import { flagShortcut } from "./SearchToggles";
import type { OpenTarget, SearchMode, SearchSymbol } from "./types";
import { usePaletteResults } from "./usePaletteResults";

const scrollActiveIntoView = (list: HTMLElement | null) =>
  list?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });

type PaletteSessionInput = {
  where: string;
  initialMode?: SearchMode;
  recent: string[];
  activePath?: string;
  symbols?: (query: string) => Promise<SearchSymbol[]>;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
};

/**
 * Everything an open Search Everywhere keeps: the mode and text, the results
 * for them, which row is active, and the keys that move through the rows,
 * switch mode (Tab) and open the active one (Enter).
 */
export function usePaletteSession({
  where,
  initialMode = "all",
  recent,
  activePath,
  symbols,
  onOpen,
  onClose,
}: PaletteSessionInput) {
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const modes = modesFor(!!symbols);
  const [mode, setMode] = useState(() => startingMode(initialMode, !!symbols));
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const { flags, toggle } = useSearchFlags();
  const results = usePaletteResults({ where, mode, text, flags, recent, activePath, symbols });
  useReturnFocus();
  useEffect(() => {
    input.current?.focus();
  }, []);
  const activeIndex = Math.min(active, results.rows.length - 1);
  useEffect(() => {
    scrollActiveIntoView(list.current);
  }, [activeIndex, mode]);
  const choose = (row: Row | undefined) => {
    if (!row) return;
    onClose();
    onOpen(row.target);
  };
  const switchTo = (next: SearchMode) => {
    setMode(next);
    setActive(0);
    input.current?.focus();
  };
  const moveActive = (step: 1 | -1) => {
    const count = results.rows.length;
    if (count) setActive((activeIndex + step + count) % count);
  };
  const changeText = (next: string) => {
    setText(next);
    setActive(0);
  };
  function onKeyDown(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return;
    if (mode === "text" && flagShortcut(e, toggle)) return e.preventDefault();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Tab") {
      e.preventDefault();
      switchTo(modeAfter(modes, mode, e.shiftKey ? -1 : 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results.rows[activeIndex]);
    }
  }

  return {
    list,
    input,
    modes,
    mode,
    text,
    flags,
    toggle,
    results,
    activeIndex,
    setActive,
    choose,
    switchTo,
    changeText,
    onKeyDown,
  };
}
