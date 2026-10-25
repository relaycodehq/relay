import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { PickItem } from "./SymbolPicker";

/** Whether `item` contains every word of the filter, in its name, path or line. */
function matchesFilter(item: PickItem, words: string[]) {
  const text =
    `${item.name ?? ""} ${item.path} ${item.preview ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * What a picker's list needs: the typed filter, the items it leaves, the one
 * selected, and the keys that move it (↑↓), pick it (Enter) or leave (Esc).
 */
export function usePickerList(
  items: PickItem[] | undefined,
  onPick: (item: PickItem) => void,
  onClose: () => void,
) {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return (items ?? []).filter((item) => matchesFilter(item, words));
  }, [items, filter]);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    setSelected(0);
  }, [filter, items]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[selected];
      if (item) onPick(item);
    }
  };

  return {
    filter,
    setFilter,
    selected,
    setSelected,
    shown,
    input,
    list,
    onKeyDown,
  };
}
