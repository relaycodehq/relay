import { useEffect, useState } from "react";
import { readText, writeText } from "../../lib/persisted-store";

/**
 * The repository the Pull requests page shows, by `repoKey`, which names its
 * server; the older per-account keys named none, so they're left behind.
 */
export function usePullsRepo() {
  const key = "relay-pulls-repo";
  const [repo, setRepo] = useState(() => readText(key) || null);
  useEffect(() => writeText(key, repo || null), [repo]);
  return [repo, setRepo] as const;
}
