import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { branchNameProblem } from "../../../shared/branch-names";
import { api } from "../../lib/api";
import "../changes/worktrees.css";

/** `value` once it has stopped changing for `ms`. */
function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Before a worktree thread's first message: the branch its worktree will be
 * made on. Empty leaves it to Relay, which names it after the thread's title
 * once that's written; a typed name must not exist yet.
 */
export function WorktreeBranchField({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  /** The typed name; empty leaves it to Relay. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const typed = useSettled(value.trim(), 250);
  const malformed = typed ? branchNameProblem(typed) : undefined;
  const check = useQuery({
    queryKey: ["worktree-branch", projectId, "check", typed],
    queryFn: () => api.worktreeBranch(projectId, typed),
    enabled: !!typed && !malformed,
    staleTime: 5000,
  });
  const current = value.trim() === typed;
  const problem = current
    ? (malformed ?? (check.data?.branch === typed && check.data.problem))
    : undefined;
  return (
    <span className="worktree-branch-field">
      <GitBranch size={13} />
      <input
        className="worktree-branch-input"
        aria-label="Branch for the new worktree"
        aria-invalid={!!problem || undefined}
        title={
          problem ||
          "The new worktree's branch. Relay names it after the thread's title; type to name it yourself"
        }
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        placeholder="named after your message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            onChange("");
            e.currentTarget.blur();
          }
        }}
      />
      {problem && (
        <span className="worktree-branch-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
