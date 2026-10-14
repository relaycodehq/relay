import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";

export const elsewhereKey = (chatId: string) => ["elsewhere", chatId];

/**
 * What the thread and the threads it started changed outside its folder.
 * Polled while Changes shows, as other repositories have no watcher here.
 */
export function useElsewhere(chatId: string | undefined) {
  return useQuery({
    queryKey: elsewhereKey(chatId ?? ""),
    queryFn: () => api.threadElsewhere(chatId!),
    enabled: !!chatId,
    refetchInterval: 5000,
  });
}

/** A file picked in another repository. */
export interface ElsewherePick {
  root: string;
  path: string;
}
