// The findings a fix request covers, from when it's sent until its answer ends.
import type { DeepReviewState } from "../../shared/deep-review";
import type { ProjectChatSend } from "../../shared/projects";

/** Marks the findings `input` asks the lead to fix as being fixed. */
export function startFixing(
  state: DeepReviewState | undefined,
  input: ProjectChatSend,
) {
  const known = new Set(state?.report?.findings.map((f) => f.id));
  const ids = (input.fixes ?? []).filter((id) => known.has(id));
  if (!state || !ids.length) return;
  state.statuses ??= {};
  for (const id of ids) state.statuses[id] = "fixing";
  (state.fixing ??= {})[input.id] = ids;
}

/**
 * Settles what `request` was fixing: fixed when its answer completed, open
 * again otherwise. False when it wasn't a fix request.
 */
export function settleFixes(
  state: DeepReviewState,
  request: string | undefined,
  fixed: boolean,
) {
  const fixes = request ? state.fixing?.[request] : undefined;
  if (!fixes) return false;
  for (const id of fixes)
    if (state.statuses?.[id] === "fixing")
      state.statuses[id] = fixed ? "fixed" : "open";
  delete state.fixing![request!];
  return true;
}
