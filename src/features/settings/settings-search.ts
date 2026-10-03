import type { ReactNode } from "react";
import type { SettingsCategory } from "../../lib/settings-page";

/** One setting: what search reads, and how the page draws it. */
export interface SettingEntry {
  id: string;
  category: SettingsCategory;
  /** A heading within the category, shared by the entries that follow. */
  section?: string;
  title: string;
  description?: string;
  keywords?: string;
  /** Block entries put their control under the text instead of beside it. */
  block?: boolean;
  /** A small control beside the title, for block entries. */
  accessory?: () => ReactNode;
  /** Entries that draw their whole card, given their (highlighted) title. */
  card?: (title: ReactNode) => ReactNode;
  render?: () => ReactNode;
}

export const searchWords = (query: string) =>
  query.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Whether every word is in the entry's text or its category's name. */
export const matches = (
  entry: SettingEntry,
  words: string[],
  categoryLabel: string,
) =>
  words.every((word) =>
    [entry.title, entry.description, entry.keywords, categoryLabel]
      .join(" ")
      .toLowerCase()
      .includes(word),
  );

/** Runs of entries under the same heading, in order. */
export function sections(entries: SettingEntry[]) {
  const runs: { section?: string; list: SettingEntry[] }[] = [];
  for (const entry of entries) {
    const last = runs.at(-1);
    if (last && last.section === entry.section) last.list.push(entry);
    else runs.push({ section: entry.section, list: [entry] });
  }
  return runs;
}

/** `text` split around the query's first word, if it's there. */
export function highlight(text: string, query: string) {
  const word = query.trim().split(/\s+/)[0];
  const at = word ? text.toLowerCase().indexOf(word.toLowerCase()) : -1;
  if (at < 0) return undefined;
  return [
    text.slice(0, at),
    text.slice(at, at + word.length),
    text.slice(at + word.length),
  ] as const;
}
