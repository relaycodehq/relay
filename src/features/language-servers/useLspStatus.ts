import { useEffect, useState } from "react";
import type { LspServerStatus } from "../../../shared/language-servers";
import { api } from "../../lib/api";
import { onLspStatus } from "./client";
import { mergeStatus } from "./status";

/** The language servers a workspace has used, kept current as they start, load and stop. */
export function useLspStatus(where: string | null | undefined) {
  const [statuses, setStatuses] = useState<LspServerStatus[]>([]);
  useEffect(() => {
    setStatuses([]);
    if (!where) return;
    let live = true;
    // The snapshot fills in only servers no event has spoken for yet.
    const heard = new Set<string>();
    const off = onLspStatus(where, ({ where: _, ...status }) => {
      heard.add(status.server);
      setStatuses((old) => mergeStatus(old, status));
    });
    api.lspStatus(where).then(
      (snapshot) => {
        if (!live) return;
        setStatuses((old) =>
          snapshot.filter((s) => !heard.has(s.server)).reduce(mergeStatus, old),
        );
      },
      () => {},
    );
    return () => {
      live = false;
      off();
    };
  }, [where]);
  return statuses;
}
