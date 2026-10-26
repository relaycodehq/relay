import { useMemo, useRef } from "react";
import { api } from "../../../lib/api";
import type { FileDocument } from "../documents";
import { changePopup, type ChangeHost } from "./change-popup";

/**
 * The popup on this document's change bars. It commits only when the bars
 * compare with the project's last commit, not with a baseline or a pull
 * request's head.
 */
export function useChangePopup(doc: FileDocument, againstHead: boolean, toggleInline: () => void) {
  const latest = useRef({ doc, toggleInline });
  latest.current = { doc, toggleInline };
  const where = doc.source.kind === "project" && againstHead ? doc.source.where : undefined;
  return useMemo(() => {
    const host: ChangeHost = { toggleInline: () => latest.current.toggleInline() };
    if (where !== undefined) {
      host.commit = async ({ compared, content, message }) => {
        const { doc } = latest.current;
        // Saved first, as PhpStorm does, so the file on disk has what was committed.
        if (doc.status.dirty && !(await doc.save())) throw new Error("The file couldn't be saved first.");
        await api.projectCommitFileChange(where, { path: doc.path, committed: compared, content, message });
        await doc.check();
      };
      host.suggest = ({ compared, content }) =>
        api.projectChangeCommitMessage(where, { path: latest.current.doc.path, committed: compared, content });
    }
    return changePopup(host);
  }, [where]);
}
