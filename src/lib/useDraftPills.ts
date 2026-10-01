import { useMemo, useRef } from "react";
import { promptContent } from "./prompt-content";
import { draftChips } from "./thread-storage";

export type DraftPills = ReturnType<typeof useDraftPills>;

/**
 * The skills, quotes and files this draft made pills of, kept beside it. Only
 * these come back as pills, so the same text typed by hand stays text.
 */
export function useDraftPills(draftKey: string) {
  const chips = useMemo(() => draftChips(draftKey), [draftKey]);
  const labels = useRef<Record<string, string>>(null!);
  const quotes = useRef<string[]>(null!);
  const files = useRef<string[]>(null!);
  labels.current ??= chips.skills.load();
  quotes.current ??= chips.quotes.load();
  files.current ??= chips.files.load();
  return useMemo(
    () => ({
      /** The editor document showing `value`, with this draft's pills. */
      content: (value: string) =>
        promptContent(value, labels.current, quotes.current, files.current),
      addSkill(token: string, label: string) {
        labels.current[token] = label;
        chips.skills.save(labels.current);
      },
      setQuotes(list: string[]) {
        quotes.current = list;
        chips.quotes.save(list);
      },
      addFiles(paths: string[]) {
        files.current = [...new Set([...files.current, ...paths])];
        chips.files.save(files.current);
      },
    }),
    [chips],
  );
}
