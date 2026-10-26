import { useMemo, useState } from "react";
import type { ProjectReplaceResult } from "../../../shared/project-search";
import { errorMessage } from "../../../shared/error-message";
import { replaceScope } from "./search-model";
import { useSearchFlags, useSearchQuery } from "./search-options";
import type { OpenTarget } from "./types";
import { useFindFields } from "./useFindFields";
import { useFindKeys } from "./useFindKeys";
import { useProjectSearch } from "./useProjectSearch";
import { useReplaceFlow } from "./useReplaceFlow";
import { useResultTree } from "./useResultTree";

/**
 * The find panel's state: its fields and options, the search they make, the
 * matches as a tree, the replace-all steps and the panel's keys.
 */
export function useFindPanel({
  where,
  initialQuery,
  replace,
  focusKey,
  slot,
  onOpen,
  onClose,
  onReplaced,
}: {
  where: string;
  initialQuery?: string;
  replace: boolean;
  focusKey?: number;
  slot: string;
  onOpen: (target: OpenTarget) => void;
  onClose: () => void;
  onReplaced?: (result: ProjectReplaceResult) => void;
}) {
  const fields = useFindFields({ initialQuery, replace, focusKey });
  const { flags, toggle } = useSearchFlags();
  const [searchRuns, setSearchRuns] = useState(0);
  const query = useSearchQuery(fields.find, flags, {
    include: fields.include,
    exclude: fields.exclude,
  });
  const { result, loading, error } = useProjectSearch(
    where,
    query,
    slot,
    250,
    searchRuns,
  );
  const files = useMemo(() => result?.files ?? [], [result]);
  const tree = useResultTree(files);
  const scope = replaceScope(files, tree.excluded);
  const flow = useReplaceFlow({
    where,
    query,
    replacement: fields.replacement,
    files: scope.files,
    onReplaced,
    searchAgain: () => setSearchRuns((n) => n + 1),
  });
  const onKeyDown = useFindKeys({
    findInput: fields.findInput,
    toggle,
    tree,
    onOpen,
    onClose,
  });
  const problem = error ? errorMessage(error) : undefined;
  return {
    fields,
    flags,
    toggle,
    query,
    result,
    loading,
    tree,
    scope,
    flow,
    onKeyDown,
    problem,
  };
}
