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
    [
      entry.title,
      entry.description,
      entry.section,
      entry.keywords,
      categoryLabel,
    ]
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

/** Every occurrence of every search word, with overlapping ranges merged. */
export function highlight(text: string, query: string) {
  const words = [...new Set(searchWords(query))].sort(
    (a, b) => b.length - a.length,
  );
  if (!words.length) return [{ text, matched: false }];
  // Escape literal search words; punctuation must not become a regex.
  const pattern = new RegExp(
    `(?=(${words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`,
    "gi",
  );
  const ranges: { start: number; end: number }[] = [];
  // Look at every offset so overlapping words ("settle settled") both count.
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[1].length;
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  const parts: { text: string; matched: boolean }[] = [];
  let cursor = 0;
  for (const { start, end } of ranges) {
    if (start > cursor)
      parts.push({ text: text.slice(cursor, start), matched: false });
    parts.push({ text: text.slice(start, end), matched: true });
    cursor = end;
  }
  if (cursor < text.length || !parts.length)
    parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}
