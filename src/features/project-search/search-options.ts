import { useMemo } from "react";
import type { ProjectSearchQuery } from "../../../shared/project-search";
import { useStoredFlag } from "../../lib/useStoredFlag";

export interface SearchFlags {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** Match case, whole words and regex, kept per device and shared by the palette and the panel. */
export function useSearchFlags() {
  const [caseSensitive, setCase] = useStoredFlag("relay.search.case");
  const [wholeWord, setWord] = useStoredFlag("relay.search.word");
  const [regex, setRegex] = useStoredFlag("relay.search.regex");
  return {
    flags: { regex, caseSensitive, wholeWord } satisfies SearchFlags,
    toggle: {
      caseSensitive: () => setCase((on) => !on),
      wholeWord: () => setWord((on) => !on),
      regex: () => setRegex((on) => !on),
    },
  };
}

/** The query for `pattern`, or null when there is nothing to look for yet. */
export function useSearchQuery(
  pattern: string,
  flags: SearchFlags,
  extra: { include?: string; exclude?: string; limit?: number } = {},
  minLength = 1,
): ProjectSearchQuery | null {
  const { include, exclude, limit } = extra;
  const { regex, caseSensitive, wholeWord } = flags;
  return useMemo(
    () =>
      pattern.length < minLength || !pattern.trim()
        ? null
        : {
            pattern,
            regex,
            caseSensitive,
            wholeWord,
            ...(include?.trim() ? { include: include.trim() } : {}),
            ...(exclude?.trim() ? { exclude: exclude.trim() } : {}),
            ...(limit ? { limit } : {}),
          },
    [
      pattern,
      regex,
      caseSensitive,
      wholeWord,
      include,
      exclude,
      limit,
      minLength,
    ],
  );
}
