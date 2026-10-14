import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { ChangesReview } from "../ChangesPane";
import type { ElsewherePick } from "./useElsewhere";

/** A file in another repository against its HEAD, read again as the list refreshes. */
export function ElsewhereReview({
  chatId,
  pick,
  revision,
  onOpenOutside,
}: {
  chatId: string;
  pick: ElsewherePick;
  /** The repository's working tree as last listed. */
  revision: string | undefined;
  /** Opens a file outside the thread's folder by its absolute path. */
  onOpenOutside?: (path: string) => void;
}) {
  const diff = useQuery({
    queryKey: ["elsewhere-diff", chatId, pick.root, pick.path, revision],
    queryFn: () => api.threadElsewhereDiff(chatId, pick.root, pick.path),
    gcTime: 0,
  });
  const absolute = `${pick.root}/${pick.path}`;
  return (
    <ChangesReview
      path={absolute}
      sides={{ deletions: "HEAD", additions: "Working tree" }}
      diff={diff}
      loading="Reading the change…"
      empty="Pick a file"
      onOpenFile={() => onOpenOutside?.(absolute)}
    />
  );
}
