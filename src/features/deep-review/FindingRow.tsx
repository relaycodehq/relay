import { CircleCheck, Undo2, X } from "lucide-react";
import type {
  DeepReviewState,
  Finding,
  FindingStatus,
} from "../../../shared/deep-review";
import type { ProjectFileLink } from "../../../shared/project-file-links";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { FileEntryIcon } from "../../ui/FileEntryIcon";
import { PriorityTag, findingRowId } from "./PriorityTag";

/** One finding: its tick, priority, title and status, who found it, and its files. */
export function FindingRow({
  finding: f,
  status,
  chatId,
  reviewers,
  ticked,
  busy,
  onToggle,
  onStatus,
  onOpenFile,
}: {
  finding: Finding;
  status: FindingStatus;
  chatId: string;
  reviewers: DeepReviewState["reviewers"];
  ticked: boolean;
  busy: boolean;
  onToggle: () => void;
  onStatus: (status: "open" | "dismissed") => void;
  onOpenFile: (target: ProjectFileLink) => void;
}) {
  return (
    <li
      id={findingRowId(chatId, f.id)}
      className="deep-review-task"
      data-status={status}
    >
      <label className="deep-review-task-head" title={f.check}>
        {status === "fixed" ? (
          <CircleCheck
            size={15}
            className="deep-review-task-fixed"
            aria-label="Fixed"
          />
        ) : (
          <input
            type="checkbox"
            aria-label={`Fix ${f.title}`}
            checked={status === "open" && ticked}
            disabled={status !== "open" || busy}
            onChange={onToggle}
          />
        )}
        <PriorityTag finding={f} chatId={chatId} />
        <span className="deep-review-task-title">{f.title}</span>
        {status === "fixing" && (
          <span className="deep-review-status">Fixing…</span>
        )}
        {status === "dismissed" && (
          <span className="deep-review-status">
            Dismissed
            <button
              type="button"
              className="text-button"
              onClick={(e) => {
                e.preventDefault();
                onStatus("open");
              }}
            >
              <Undo2 size={12} /> Undo
            </button>
          </span>
        )}
        <span
          className="deep-review-found-by"
          title={`Found by reviewer ${f.reviewers.join(", ")}`}
        >
          {f.reviewers.map((n) => {
            const reviewer = reviewers[n - 1];
            return reviewer ? (
              <ProviderIcon key={n} provider={reviewer.provider} />
            ) : null;
          })}
          {f.reviewers.length > 0 &&
            `${f.reviewers.length}/${reviewers.length}`}
        </span>
        {status === "open" && (
          <button
            type="button"
            className="icon-button deep-review-dismiss"
            aria-label={`Dismiss ${f.title}`}
            title="Dismiss"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onStatus("dismissed");
            }}
          >
            <X size={13} />
          </button>
        )}
      </label>
      {f.files.length > 0 && (
        <ul className="deep-review-task-files">
          {f.files.map((file) => (
            <li key={`${file.path}:${file.line ?? ""}`}>
              <button
                type="button"
                className="deep-review-task-file"
                title={`${file.path}${file.line ? `:${file.line}` : ""}`}
                onClick={() =>
                  onOpenFile({
                    path: file.path,
                    ...(file.line ? { line: file.line } : {}),
                    directory: false,
                  })
                }
              >
                <FileEntryIcon path={file.path} directory={false} />
                <span className="deep-review-task-file-name">
                  {file.path.split("/").pop()}
                </span>
                {file.line && (
                  <span className="deep-review-task-file-line">
                    L{file.line}
                  </span>
                )}
                <span className="deep-review-task-file-dir">
                  {file.path.split("/").slice(0, -1).join("/")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
