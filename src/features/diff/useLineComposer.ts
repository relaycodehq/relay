import { useState } from "react";
import type { SelectedLineRange } from "@pierre/diffs";
import type { Draft, Side } from "../../../shared/types";
import type { OpenComposer } from "./diff-annotations";

/**
 * The new line comment box on a PR file's diff. What's typed is saved as a
 * draft as it changes, so the box itself holds no text.
 */
export function useLineComposer({
  path,
  drafts,
  addDraft,
  removeDraft,
  onSaved,
}: {
  path: string;
  drafts: Draft[];
  addDraft: (
    path: string,
    line: number,
    side: Side,
    body: string,
    id: string,
  ) => void;
  removeDraft: (id: string) => void;
  onSaved: () => void;
}) {
  const [composer, setComposer] = useState<OpenComposer | null>(null);
  /** Opens the box under the last line of `range`. */
  const begin = (range: SelectedLineRange | null) => {
    if (range)
      setComposer({
        id: crypto.randomUUID(),
        line: range.end,
        side: range.endSide ?? range.side ?? "additions",
      });
  };
  const body = () => drafts.find((d) => d.id === composer?.id)?.body ?? "";
  const change = (body: string) => {
    if (!composer) return;
    // A draft exists only while it has text, so a box left open when the
    // reader moves on leaves nothing behind.
    if (body) addDraft(path, composer.line, composer.side, body, composer.id);
    else removeDraft(composer.id);
  };
  const save = () => {
    setComposer(null);
    onSaved();
  };
  const cancel = () => {
    if (composer) removeDraft(composer.id);
    setComposer(null);
  };
  return { composer, begin, body, change, save, cancel };
}

export type LineComposer = ReturnType<typeof useLineComposer>;
