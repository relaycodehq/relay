import { useLspStatus } from "./useLspStatus";
import { summarizeStatuses } from "./status";
import "./language-servers.css";

/** Where the language servers of a workspace stand, as muted text; nothing when none runs. */
export function LspStatusText({ where }: { where: string | null | undefined }) {
  const text = summarizeStatuses(useLspStatus(where));
  return text ? (
    <span className="lsp-status" title={text}>
      {text}
    </span>
  ) : null;
}
