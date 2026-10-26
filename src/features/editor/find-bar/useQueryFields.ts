import { useEffect, useState } from "react";
import type { SearchQuery } from "@codemirror/search";

/** The parts of a query the bar edits. */
export type QueryFields = Pick<
  SearchQuery,
  "search" | "replace" | "caseSensitive" | "wholeWord" | "regexp"
>;

/**
 * The find and replace fields, which keep their own text so a keystroke
 * shows at once; a query set from outside (⌘F on a selection) still lands
 * in them.
 */
export function useQueryFields(
  query: SearchQuery,
  onQuery: (fields: QueryFields) => void,
) {
  const [search, setSearch] = useState(query.search);
  const [replace, setReplace] = useState(query.replace);
  useEffect(() => setSearch(query.search), [query.search]);
  useEffect(() => setReplace(query.replace), [query.replace]);
  const fields: QueryFields = {
    search,
    replace,
    caseSensitive: query.caseSensitive,
    wholeWord: query.wholeWord,
    regexp: query.regexp,
  };

  return {
    search,
    replace,
    typeSearch: (text: string) => {
      setSearch(text);
      onQuery({ ...fields, search: text });
    },
    typeReplace: (text: string) => {
      setReplace(text);
      onQuery({ ...fields, replace: text });
    },
    toggle: (name: "caseSensitive" | "wholeWord" | "regexp") =>
      onQuery({ ...fields, [name]: !query[name] }),
  };
}
