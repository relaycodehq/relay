import { useMemo, useRef } from "react";
import type { CodeReference } from "../../../shared/code-references";
import { keys } from "../../lib/mod-key";
import { askSelection, selectedLines } from "./ask-selection";

/** Asking in chat about the selected lines of a read-only `path`, as the version `label` names. */
export function useAskSelection(
  path: string,
  label: string,
  onAsk: ((ref: CodeReference) => void) | undefined,
) {
  const latest = useRef(onAsk);
  latest.current = onAsk;
  const asks = !!onAsk;
  return useMemo(
    () =>
      asks
        ? askSelection((view) => {
            const lines = selectedLines(view.state);
            if (lines) latest.current?.({ path, ...lines, label });
          }, keys("⌥⏎", "Alt+Enter"))
        : undefined,
    [asks, path, label],
  );
}
