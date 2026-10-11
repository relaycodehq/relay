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
  /** The result ↑/↓ moved to, for this query only. */
  const [picked, setPicked] = useState<{ query: string; id: string }>();
  const query = text.trim().toLowerCase();
  const results = chats.filter((c) =>
    `${c.title} ${projects.get(c.projectId)?.name ?? ""}`
      .toLowerCase()
      .includes(query),
  );
  const listed =
    allResultsFor === query ? results : results.slice(0, SEARCH_RESULTS);
  const at = Math.max(
    0,
    listed.findIndex((c) => picked?.query === query && c.id === picked.id),
  );
  return {
    text,
    setText,
    query,
    results,
    listed,
    listAll: () => setAllResultsFor(query),
    /** The result Enter opens: the first, until ↑/↓ moved. */
    highlighted: listed[at] as ChatSummary | undefined,
    move(step: 1 | -1) {
      const next = listed[(at + step + listed.length) % listed.length];
      if (next) setPicked({ query, id: next.id });
    },
  };
}
