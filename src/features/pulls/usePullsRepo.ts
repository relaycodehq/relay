import { useEffect, useState } from "react";

/**
 * The repository the Pull requests page shows, by `repoKey`, which names its
 * server; the older per-account keys named none, so they're left behind.
 */
export function usePullsRepo() {
  const key = "relay-pulls-repo";
  const [repo, setRepo] = useState(() => localStorage.getItem(key) || null);
  useEffect(() => {
    if (repo) localStorage.setItem(key, repo);
    else localStorage.removeItem(key);
  }, [repo]);
  return [repo, setRepo] as const;
}
