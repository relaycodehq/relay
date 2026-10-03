import { useState } from "react";
import type { ChatSummary, Project } from "../../../shared/projects";

const SEARCH_RESULTS = 50;

export type ThreadSearch = ReturnType<typeof useThreadSearch>;

/** The sidebar's search over thread titles and their projects' names. */
export function useThreadSearch(
  chats: ChatSummary[],
  projects: Map<string, Project>,
) {
  const [text, setText] = useState("");
  /** The query whose results are listed past the first SEARCH_RESULTS. */
  const [allResultsFor, setAllResultsFor] = useState<string>();
  const query = text.trim().toLowerCase();
  const results = chats.filter((c) =>
    `${c.title} ${projects.get(c.projectId)?.name ?? ""}`
      .toLowerCase()
      .includes(query),
  );
  return {
    text,
    setText,
    query,
    results,
    listed:
      allResultsFor === query ? results : results.slice(0, SEARCH_RESULTS),
    listAll: () => setAllResultsFor(query),
  };
}
