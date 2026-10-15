import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../../lib/api";

export const elsewhereKey = (chatId: string) => ["elsewhere", chatId];

/**
 * What the thread and the threads it started changed outside its folder.
 * Relay says when that may read differently: a turn recorded other files, or
 * one of the other repositories changed. The slow poll catches what a watch
 * misses, and stands in for it where Relay can't watch.
 */
export function useElsewhere(chatId: string | undefined) {
  const watched = useElsewhereWatch(chatId ?? null);
  return useQuery({
    queryKey: elsewhereKey(chatId ?? ""),
    queryFn: () => api.threadElsewhere(chatId!),
    enabled: !!chatId,
    refetchInterval: watched ? 60_000 : 30_000,
  });
}

/**
 * The same list, read without watching: enough to know whether there is
 * one. The Changes pane's `useElsewhere` keeps it fresh while it shows.
 */
export function useElsewhereListed(chatId: string | undefined) {
  return useQuery({
    queryKey: elsewhereKey(chatId ?? ""),
    queryFn: () => api.threadElsewhere(chatId!),
    enabled: !!chatId,
    refetchInterval: 60_000,
  });
}

/**
 * Asks Relay to say when `chatId`'s changes elsewhere may read differently,
 * and refreshes them then; true while Relay watches their repositories. One
 * per window, as with the working tree. A hidden window refreshes once it
 * shows again.
 */
function useElsewhereWatch(chatId: string | null) {
  const qc = useQueryClient();
  const [watched, setWatched] = useState<string | null>(null);
  useEffect(() => {
    if (chatId === null) return;
    let missed = false,
      live = true;
    const refresh = () => {
      missed = false;
      void qc.invalidateQueries({
        queryKey: elsewhereKey(chatId),
        exact: true,
      });
    };
    const off = api.onElsewhere((changed) => {
      if (changed !== chatId) return;
      if (document.hidden) missed = true;
      else refresh();
    });
    const shown = () => {
      if (missed && !document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", shown);
    api.watchElsewhere(chatId).then(
      (ok) => live && setWatched(ok ? chatId : null),
      () => live && setWatched(null),
    );
    return () => {
      live = false;
      off();
      document.removeEventListener("visibilitychange", shown);
      void api.watchElsewhere(null).catch(() => {});
    };
  }, [chatId, qc]);
  return chatId !== null && watched === chatId;
}

/** A file picked in another repository. */
export interface ElsewherePick {
  root: string;
  path: string;
}
