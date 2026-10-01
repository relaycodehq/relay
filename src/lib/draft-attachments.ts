import { lineQuestionSchema, type LineQuestion } from "../../shared/questions";
import { workItemMessage, type WorkItem } from "../../shared/devops";
import {
  codeReferenceMessage,
  isCodeReference,
  type CodeReference,
} from "../../shared/code-references";
import type { ComposedSend } from "../../shared/compose-send";

// What a thread's main composer attached besides its text, kept per thread
// (or unsent thread) until the message goes.
function read(key: string, fallback: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || fallback);
  } catch {
    return undefined;
  }
}

export const loadSelection = (id: string): LineQuestion | undefined =>
  lineQuestionSchema.safeParse(read("chat-selection:" + id, "null")).data;

export function loadWorkItem(id: string): WorkItem | undefined {
  const saved = read("chat-work-item:" + id, "null") as WorkItem | null;
  return typeof saved?.id === "number" && typeof saved.title === "string"
    ? saved
    : undefined;
}

export function loadCodeRefs(id: string): CodeReference[] {
  const saved = read("chat-code-refs:" + id, "[]");
  return Array.isArray(saved) ? saved.filter(isCodeReference) : [];
}

export function clearDraftAttachments(id: string) {
  for (const kind of ["chat-selection:", "chat-work-item:", "chat-code-refs:"])
    localStorage.removeItem(kind + id);
}

export interface DraftAttachments {
  workItem?: WorkItem;
  codeRefs: CodeReference[];
  selection?: LineQuestion;
}

export const loadDraftAttachments = (id: string): DraftAttachments => ({
  workItem: loadWorkItem(id),
  codeRefs: loadCodeRefs(id),
  selection: loadSelection(id),
});

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
