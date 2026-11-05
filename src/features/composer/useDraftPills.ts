import { useMemo } from "react";
import { promptContent } from "./prompt-content";
import { draftChips } from "../../lib/thread-storage";
import type { CopiedPills } from "./prompt/pill-clipboard";

export type DraftPills = ReturnType<typeof useDraftPills>;

/**
 * The skills, quotes and files this draft made pills of, kept beside it. Only
 * these come back as pills, so the same text typed by hand stays text.
 * Read from storage each time: a phone or another window showing the same
 * draft adds pills there too.
 */
export function useDraftPills(draftKey: string) {
  return useMemo(() => {
    const chips = draftChips(draftKey);
    const addFiles = (paths: string[]) =>
      chips.files.save([...new Set([...chips.files.load(), ...paths])]);
    return {
      /** The editor document showing `value`, with this draft's pills. */
      content: (value: string) =>
        promptContent(
          value,
          chips.skills.load(),
          chips.quotes.load(),
          chips.files.load(),
        ),
      addSkill(token: string, label: string) {
        chips.skills.save({ ...chips.skills.load(), [token]: label });
      },
      setQuotes(list: string[]) {
        chips.quotes.save(list);
      },
      addFiles,
      /** Takes on pills copied from another draft or message, so pasting them makes pills. */
      adopt({ skills, quotes: copied, files: paths }: CopiedPills) {
        if (Object.keys(skills).length)
          chips.skills.save({ ...chips.skills.load(), ...skills });
        if (copied.length)
          chips.quotes.save([...new Set([...chips.quotes.load(), ...copied])]);
        if (paths.length) addFiles(paths);
      },
    };
  }, [draftKey]);
}
