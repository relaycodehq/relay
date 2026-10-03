import { useEffect, useState } from "react";
import {
  sameCodeReference,
  type CodeReference,
} from "../../../shared/code-references";
import type { LineQuestion } from "../../../shared/questions";
import { threadStorage } from "../../lib/thread-storage";

export type ComposerAttachments = ReturnType<typeof useComposerAttachments>;

/**
 * What the thread's main composer holds besides its text: a selected line,
 * a work item and code references. Kept per thread until the message goes.
 */
export function useComposerAttachments(id: string) {
  const [selection, setSelection] = useState(() =>
    threadStorage(id).selection.load(),
  );
  const [workItem, setWorkItem] = useState(() =>
    threadStorage(id).workItem.load(),
  );
  const [codeRefs, setCodeRefs] = useState(() =>
    threadStorage(id).codeRefs.load(),
  );
  useEffect(() => threadStorage(id).selection.save(selection), [id, selection]);
  useEffect(() => threadStorage(id).workItem.save(workItem), [id, workItem]);
  useEffect(() => threadStorage(id).codeRefs.save(codeRefs), [id, codeRefs]);
  return {
    selection,
    setSelection,
    workItem,
    setWorkItem,
    codeRefs,
    setCodeRefs,
    /** Adds the references not attached already. */
    addCodeRefs(added: CodeReference[]) {
      setCodeRefs((refs) => {
        const fresh = added.filter(
          (next) => !refs.some((ref) => sameCodeReference(ref, next)),
        );
        return fresh.length ? [...refs, ...fresh] : refs;
      });
    },
    /** Saved at once rather than by the effect, for a caller about to drop the only other copy. */
    restoreSelection(restored: LineQuestion) {
      threadStorage(id).selection.save(restored);
      setSelection(restored);
    },
    /** Gone with the message they went out with. */
    clear() {
      setSelection(undefined);
      setWorkItem(undefined);
      setCodeRefs([]);
    },
  };
}
