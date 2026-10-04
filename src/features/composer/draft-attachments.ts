import type { LineQuestion } from "../../../shared/questions";
import { workItemMessage, type WorkItem } from "../../../shared/devops";
import {
  codeReferenceMessage,
  type CodeReference,
} from "../../../shared/code-references";
import type { ComposedSend } from "../../../shared/compose-send";
import { threadStorage } from "../../lib/thread-storage";

// What a thread's main composer attached besides its text, kept per thread
// (or unsent thread) until the message goes.
/** Clears what went out with `sent`, keeping anything attached since. */
export function clearDraftAttachments(id: string, sent: DraftAttachments) {
  const { selection, workItem, codeRefs } = threadStorage(id);
  const same = (now: unknown, then: unknown) =>
    JSON.stringify(now) === JSON.stringify(then);
  if (same(selection.load(), sent.selection)) selection.clear();
  if (same(workItem.load(), sent.workItem)) workItem.clear();
  if (same(codeRefs.load(), sent.codeRefs)) codeRefs.clear();
}

export interface DraftAttachments {
  workItem?: WorkItem;
  codeRefs: CodeReference[];
  selection?: LineQuestion;
}

export function loadDraftAttachments(id: string): DraftAttachments {
  const { selection, workItem, codeRefs } = threadStorage(id);
  return {
    workItem: workItem.load(),
    codeRefs: codeRefs.load(),
    selection: selection.load(),
  };
}

/** The message with what its draft attached: a work item and code in its text, a selection beside it. */
export function withAttachments(
  value: ComposedSend,
  { workItem, codeRefs, selection }: DraftAttachments,
): ComposedSend {
  const body = workItem ? workItemMessage(workItem, value.body) : value.body;
  return {
    ...value,
    body: codeReferenceMessage(codeRefs, body),
    ...(selection ? { selection: { ...selection, question: value.body } } : {}),
  };
}
