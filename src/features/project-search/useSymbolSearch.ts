import { useEffect, useState } from "react";
import { useStableCallback } from "../../lib/useStableCallback";
import type { SearchSymbol } from "./types";

const DELAY_MS = 150;

interface SymbolState {
  items: SearchSymbol[];
  busy: boolean;
}

const idle: SymbolState = { items: [], busy: false };

/**
 * The host's symbols matching `text`, looked up after a short pause in typing.
 * Nothing is looked up while `enabled` is false or the text is blank, and a
 * failed lookup shows no symbols.
 */
export function useSymbolSearch(
  lookup: ((query: string) => Promise<SearchSymbol[]>) | undefined,
  enabled: boolean,
  text: string,
): SymbolState {
  const [state, setState] = useState<SymbolState>(idle);
  const lookUp = useStableCallback(
    (query: string) => lookup?.(query) ?? Promise.resolve([]),
  );
  useEffect(() => {
    if (!enabled || !text.trim()) {
      setState(idle);
      return;
    }
    let live = true;
    setState((s) => ({ ...s, busy: true }));
    const timer = setTimeout(() => {
      lookUp(text.trim()).then(
        (items) => live && setState({ items, busy: false }),
        () => live && setState(idle),
      );
    }, DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, text, lookUp]);
  return state;
}
