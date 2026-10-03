import { useEffect } from "react";
import type { ChatSummary } from "../../../shared/projects";
import { attention } from "./activity";
import { api } from "../../lib/api";

/**
 * How many active threads want you; the count goes on the app's badge and
 * the strongest mark to `onAttention`, for the collapsed titlebar.
 */
export function useAttention(
  active: ChatSummary[],
  unread: (c: ChatSummary) => boolean,
  onAttention: ((mark: "waiting" | "unread" | undefined) => void) | undefined,
) {
  const { count, mark } = attention(active, unread);
  useEffect(() => onAttention?.(mark), [mark]);
  useEffect(() => {
    // A plain browser preview has no desktop bridge.
    void api?.setBadge?.(count)?.catch(() => {});
  }, [count]);
  return count;
}
