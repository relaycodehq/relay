import { useState } from "react";
import type { CodeReference } from "../../../shared/code-references";
import type { LineQuestion } from "../../../shared/questions";

/** The file a pane shows, for the chat's presence. */
export type Viewing = { path: string | null; viewed: number; total: number };
export const NO_VIEWING: Viewing = { path: null, viewed: 0, total: 0 };

/** Code the chat was asked about, for its composer to take up once. */
export interface ChatContext {
  id: string;
  text: string;
  selection?: LineQuestion;
  code?: CodeReference;
}

export type ThreadView = ReturnType<typeof useThreadView>;

/**
 * What passes between the open thread's chat and its panes: the file the
 * panes show, and code the chat was asked about. Leaving the thread clears
 * them.
 */
export function useThreadView() {
  const [viewing, setViewing] = useState<Viewing>(NO_VIEWING),
    [context, setContext] = useState<ChatContext>();
  return {
    viewing,
    setViewing,
    context,
    setContext,
    clear() {
      setContext(undefined);
      setViewing(NO_VIEWING);
    },
  };
}
