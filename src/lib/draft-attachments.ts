import { lineQuestionSchema, type LineQuestion } from "../../shared/questions";
import type { WorkItem } from "../../shared/devops";
import {
  isCodeReference,
  type CodeReference,
} from "../../shared/code-references";

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
