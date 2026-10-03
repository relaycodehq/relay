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
export function clearDraftAttachments(id: string) {
  const { selection, workItem, codeRefs } = threadStorage(id);
  for (const kind of [selection, workItem, codeRefs]) kind.clear();
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
