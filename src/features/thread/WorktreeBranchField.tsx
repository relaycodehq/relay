import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { branchNameProblem } from "../../../shared/branch-names";
import { api } from "../../lib/api";
import { useDraft } from "../composer/drafts";
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
 * made on. It shows Relay's pick, following the draft, until another name is
 * typed; that one must not exist yet.
 */
export function WorktreeBranchField({
  projectId,
  draftKey,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  draftKey: string;
  /** The typed name; empty leaves it to Relay. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const prompt = useSettled(useDraft(draftKey).trim(), 250);
  const typed = useSettled(value.trim(), 250);
  const [editing, setEditing] = useState<string>();
  const pick = useQuery({
    queryKey: ["worktree-branch", projectId, "pick", prompt],
    queryFn: () => api.worktreeBranch(projectId, prompt),
    enabled: !value.trim() && !!prompt,
    staleTime: 5000,
  });
  const malformed = typed ? branchNameProblem(typed) : undefined;
  const check = useQuery({
    queryKey: ["worktree-branch", projectId, "check", typed],
    queryFn: () => api.worktreeBranch(projectId, "", typed),
    enabled: !!typed && !malformed,
    staleTime: 5000,
  });
  const suggested = prompt ? (pick.data?.branch ?? "") : "";
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
          "The new worktree's branch. Relay names it after your message; type to name it yourself"
        }
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        placeholder="named after your message"
        value={editing ?? (value || suggested)}
        onFocus={() => setEditing(value || suggested)}
        onBlur={() => setEditing(undefined)}
        onChange={(e) => {
          setEditing(e.target.value);
          onChange(e.target.value === suggested ? "" : e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.stopPropagation();
            onChange("");
            setEditing(undefined);
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
