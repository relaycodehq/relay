import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

export const memesKey = ["memes"] as const;

/**
 * The meme folder: its list and which pictures are in. Read again each time
 * something starts watching, since an agent or an editor may have changed it.
 */
export function useMemes(enabled: boolean) {
  return useQuery({
    queryKey: memesKey,
    queryFn: () => api.memes(),
    enabled,
    staleTime: 0,
  });
}
