import { useEffect, useRef, useState } from "react";
import type { LocalHistoryEntry } from "../../../shared/local-history";
import { api } from "../../lib/api";

/** How many of the newest versions to read when opening, looking for the first that differs from the text. */
const LOOK_BACK = 6;

/**
 * A file's kept versions and the text of the selected one. Opens on the
 * newest version that differs from `current`, since the one a save just made
 * is usually the text already on screen.
 */
export function useHistoryVersions(
  where: string,
  path: string,
  current: string,
) {
  const [entries, setEntries] = useState<LocalHistoryEntry[]>();
  const [error, setError] = useState<unknown>();
  const [selectedId, setSelectedId] = useState<string>();
  /** Texts read so far, by entry id. */
  const [texts, setTexts] = useState<Record<string, string>>({});
  /** Versions that couldn't be read, by entry id; the others still can. */
  const [unreadable, setUnreadable] = useState<Record<string, unknown>>({});
  const currentText = useRef(current);
  currentText.current = current;

  useEffect(() => {
    let live = true;
    (async () => {
      const list = await api.localHistoryList(where, path);
      if (!live) return;
      setEntries(list);
      const read: Record<string, string> = {};
      const failed: Record<string, unknown> = {};
      let opened = list[0];
      for (const entry of list.slice(0, LOOK_BACK)) {
        if (entry.skipped) continue;
        try {
          read[entry.id] = await api.localHistoryRead(where, path, entry.id);
        } catch (e) {
          failed[entry.id] = e;
          continue;
        }
        if (!live) return;
        if (read[entry.id] !== currentText.current) {
          opened = entry;
          break;
        }
      }
      if (!live) return;
      setTexts((all) => ({ ...all, ...read }));
      setUnreadable((all) => ({ ...all, ...failed }));
      setSelectedId(opened?.id);
    })().catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [where, path]);

  const selected = entries?.find((e) => e.id === selectedId);
  useEffect(() => {
    if (!selected || selected.skipped) return;
    if (texts[selected.id] !== undefined || selected.id in unreadable) return;
    let live = true;
    api.localHistoryRead(where, path, selected.id).then(
      (value) => live && setTexts((all) => ({ ...all, [selected.id]: value })),
      (e) => live && setUnreadable((all) => ({ ...all, [selected.id]: e })),
    );
    return () => {
      live = false;
    };
  }, [where, path, selected, texts, unreadable]);

  return {
    entries,
    error,
    selected,
    selectedText: selected ? texts[selected.id] : undefined,
    /** Why the version picked can't be shown, when it can't. */
    selectedError: selected ? unreadable[selected.id] : undefined,
    select: setSelectedId,
  };
}
