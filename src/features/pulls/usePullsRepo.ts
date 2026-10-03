import { useEffect, useState } from "react";

/** The repository the Pull requests page shows, `owner/name`, kept per account. */
export function usePullsRepo(accountId: string) {
  const key = `relay-pulls-repo:${accountId}`;
  const [repo, setRepo] = useState(() => localStorage.getItem(key) || null);
  useEffect(() => {
    if (repo) localStorage.setItem(key, repo);
    else localStorage.removeItem(key);
  }, [repo]);
  return [repo, setRepo] as const;
}
