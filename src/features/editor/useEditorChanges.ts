import { useMemo } from "react";
import type { ChangeBaseline } from "./editor-types";
import type { FileDocument } from "./documents";
import { changeGutter, inlineBars } from "./change-gutter";
import { inlineDiff } from "./deleted-lines";
import { useEditorCompare } from "./useEditorCompare";
import { useChangePopup } from "./change-popup/useChangePopup";

/** The change bars and the lines removed since `against`, shown in place. */
export function inlineChanges(against: string) {
  // The bars read the inline diff's chunks, so they come after it.
  return [changeGutter(against), inlineDiff(against), inlineBars];
}

/**
 * The change bars, and the inline diff when it is on. `against` is what the
 * file is compared with: the document's baseline if it was opened with one,
 * else the committed text, which a folder without Git doesn't have.
 */
export function useEditorChanges({
  doc,
  inline,
  plain,
  baseline,
  committed,
  docWantsChanges,
}: {
  doc: FileDocument;
  inline: boolean;
  /** A folder without Git, so nothing committed to compare with. */
  plain: boolean;
  baseline: ChangeBaseline | undefined;
  committed: string | undefined;
  /** The document asks to show its changes whatever the editor-wide setting, as one opened from the changes does. */
  docWantsChanges: boolean | undefined;
}) {
  const against = baseline?.text ?? committed;
  const [comparing, setComparing] = useEditorCompare(inline, plain && !baseline);
  const showDiff = !!baseline || (!plain && (docWantsChanges ?? comparing));
  /** Drops this document's own choice, so the editor-wide setting applies to it again. */
  const toggleDiff = () => {
    setComparing(!showDiff);
    doc.showChanges(undefined);
  };
  const popup = useChangePopup(doc, !baseline && committed !== undefined, toggleDiff);
  const extension = useMemo(
    () => [
      showDiff && against !== undefined ? inlineChanges(against) : changeGutter(against),
      popup,
    ],
    [against, showDiff, popup],
  );
  return { extension, showDiff, toggleDiff };
}
