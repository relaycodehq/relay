import { useEffect } from "react";
import { api } from "../../lib/api";
import type { FileDocument } from "./documents";

/**
 * Looks at the disk again when `stamp` changes (the working tree moved) and
 * when the window gets focus. A folder without Git has no working tree to
 * stamp, so there it looks whenever Relay sees the folder change.
 */
export function useDiskCheck(doc: FileDocument, stamp: string | undefined) {
  useEffect(() => {
    if (stamp) void doc.check();
  }, [stamp, doc]);
  useEffect(() => {
    const check = () => void doc.check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [doc]);
  const { source } = doc;
  const plainFolder = source.kind === "project" && source.plain ? source.where : undefined;
  useEffect(() => {
    if (!plainFolder) return;
    return api.onWorkingTree((changed) => {
      if (changed === plainFolder) void doc.check();
    });
  }, [plainFolder, doc]);
}
