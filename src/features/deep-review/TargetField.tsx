import type { ReactNode } from "react";
import {
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
} from "lucide-react";
import type { ReviewTarget } from "../../../shared/deep-review";
import type { Project } from "../../../shared/projects";
import type { TargetPick } from "./useDeepReviewSetup";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { ProjectPullPicker } from "../pulls/ProjectPullPicker";

const targets: {
  kind: ReviewTarget["kind"];
  label: string;
  icon: ReactNode;
}[] = [
  {
    kind: "uncommitted",
    label: "Uncommitted changes",
    icon: <FileDiff size={14} />,
  },
  { kind: "branch", label: "Branch", icon: <GitBranch size={14} /> },
  { kind: "pr", label: "Pull request", icon: <GitPullRequest size={14} /> },
  {
    kind: "commit",
    label: "Commit",
    icon: <GitCommitHorizontal size={14} />,
  },
];

/** What to review, and the branch, pull request or commit it points at. */
export function TargetField({
  project,
  kind,
  pick,
  branch,
  changes,
  canChoosePR,
  onKind,
  onBase,
}: {
  project: Project;
  kind: ReviewTarget["kind"];
  pick: TargetPick;
  branch?: string;
  changes: number;
  canChoosePR: boolean;
  onKind: (kind: ReviewTarget["kind"]) => void;
  onBase: (base: string) => void;
}) {
  return (
    <div className="deep-review-field">
      <span className="deep-review-label">Review</span>
      <div className="deep-review-field-body">
        <div
          className="deep-review-targets"
          role="radiogroup"
          aria-label="What to review"
        >
          {targets.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="radio"
              aria-checked={t.kind === kind}
              onClick={() => onKind(t.kind)}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
        <div className="composer-tools deep-review-target">
          {kind === "uncommitted" && (
            <span className="deep-review-target-detail">
              {changes
                ? `${changes} ${changes === 1 ? "file" : "files"} changed${branch ? ` on ${branch}` : ""}`
                : "No uncommitted changes to review"}
            </span>
          )}
          {kind === "branch" &&
            (!branch ? (
              <span className="deep-review-target-detail">
                Check out the branch to review first
              </span>
            ) : (
              <>
                <span className="deep-review-target-detail">
                  <GitBranch size={13} /> {branch}
                  <span className="muted">against</span>
                </span>
                {pick.base ? (
                  <ComposerSelect
                    label="Base branch"
                    value={pick.base}
                    onChange={onBase}
                    options={pick.bases.map((b) => ({ value: b, label: b }))}
                  />
                ) : (
                  <span className="muted">
                    {pick.branchesPending
                      ? "Loading branches…"
                      : "no other branch"}
                  </span>
                )}
              </>
            ))}
          {kind === "pr" &&
            (canChoosePR ? (
              <ProjectPullPicker
                project={project}
                selected={pick.pull}
                onSelect={pick.setPull}
                placement="bottom"
              />
            ) : (
              <span className="deep-review-target-detail">
                Sign in to this repository's host to review pull requests
              </span>
            ))}
          {kind === "commit" &&
            (pick.commit ? (
              <ComposerSelect
                label="Commit"
                value={pick.commit}
                onChange={pick.setCommit}
                options={pick.commits.map((c) => ({
                  value: c.sha,
                  label: `${c.sha.slice(0, 7)} ${c.subject}`,
                }))}
              />
            ) : (
              <span className="deep-review-target-detail">
                {pick.commitsPending ? "Loading commits…" : "No commits yet"}
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}
