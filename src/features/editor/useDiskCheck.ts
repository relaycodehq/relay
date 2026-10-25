import { useEffect } from "react";
import type { FileDocument } from "./documents";

/** Looks at the disk again when `stamp` changes (the working tree moved) and when the window gets focus. */
export function useDiskCheck(doc: FileDocument, stamp: string | undefined) {
  useEffect(() => {
    if (stamp) void doc.check();
  }, [stamp, doc]);
  useEffect(() => {
    const check = () => void doc.check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [doc]);
}
