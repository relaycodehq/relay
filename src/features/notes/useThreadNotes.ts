import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChatSummary } from "../../../shared/projects";
import {
  arrangeNote,
  removeNote,
  tickNote,
  type ThreadNote,
} from "../../../shared/thread-notes";
import { api } from "../../lib/api";

const NONE: ThreadNote[] = [];
/** The mark each thread's cached notes were last brought up to. */
const cachedAt = new Map<string, string | undefined>();
export const notesKey = (chatId: string | undefined) => [
  "thread-notes",
  chatId,
];

export interface ThreadNotesHandle {
  notes: ThreadNote[];
  /** Keeps markdown from message `from`; resolves once it's saved. */
  keep: (text: string, from?: string) => Promise<void>;
  tick: (note: string, item: number, done: boolean) => void;
  /** Puts a list note's items (from 1) in `order`, dropping those left out. */
  arrange: (note: string, order: number[]) => void;
  remove: (note: string) => void;
  kept: (text: string) => boolean;
}

/**
 * The thread's notes, fetched again whenever its listed summary says they
 * moved, so one an agent keeps shows up without asking.
 */
export function useThreadNotes(
  chat: Pick<ChatSummary, "id" | "notesMark"> | undefined,
  onError: (error: unknown) => void,
): ThreadNotesHandle {
  const qc = useQueryClient();
  // Read when it's needed, so a new callback each render keeps the handle as it is.
  const errors = useRef(onError);
  errors.current = onError;
  const id = chat?.id;
  const mark = chat?.notesMark;
  const key = useMemo(() => notesKey(id), [id]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.threadNotes(id!),
    enabled: !!id && !!mark,
    staleTime: Infinity,
  });
  // Remembered past the thread being open, since its cached notes outlive that.
  useEffect(() => {
    if (!id) return;
    const known = cachedAt.has(id);
    const was = cachedAt.get(id);
    cachedAt.set(id, mark);
    if (known && was === mark) return;
    // Nothing cached yet: the first fetch is the query's own.
    if (qc.getQueryData(key) === undefined) return;
    if (mark) void qc.invalidateQueries({ queryKey: key, exact: true });
    // No mark is no notes, and a disabled query would keep showing the old ones.
    else qc.setQueryData(key, NONE);
  }, [qc, id, key, mark]);
  // A note kept here shows before the list's mark catches up.
  const notes = query.data ?? NONE;

  const change = useCallback(
    (
      next: (notes: ThreadNote[]) => ThreadNote[],
      save: () => Promise<unknown>,
    ) => {
      const before = qc.getQueryData<ThreadNote[]>(key);
      try {
        qc.setQueryData(key, next(before ?? []));
      } catch (error) {
        errors.current(error);
        return;
      }
      save().catch((error: unknown) => {
        errors.current(error);
        void qc.invalidateQueries({ queryKey: key, exact: true });
      });
    },
    [qc, key],
  );

  return useMemo(
    () => ({
      notes,
      keep: async (text, from) => {
        if (!id) return;
        try {
          const note = await api.keepThreadNote(id, text, from);
          qc.setQueryData<ThreadNote[]>(key, (list = []) =>
            list.some((n) => n.id === note.id) ? list : [...list, note],
          );
        } catch (error) {
          errors.current(error);
        }
      },
      tick: (note, item, done) =>
        id &&
        change(
          (list) => tickNote(list, note, item, done),
          () => api.tickThreadNote(id, note, item, done),
        ),
      arrange: (note, order) =>
        id &&
        change(
          (list) => arrangeNote(list, note, order),
          () => api.arrangeThreadNote(id, note, order),
        ),
      remove: (note) =>
        id &&
        change(
          (list) => removeNote(list, note),
          () => api.removeThreadNote(id, note),
        ),
      // A list kept with the line leading into it still counts.
      kept: (text) => {
        const block = text.trim();
        return notes.some(
          (n) => n.text === block || n.text.endsWith(`\n\n${block}`),
        );
      },
    }),
    [notes, id, qc, key, change],
  );
}
