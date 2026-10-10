import { useEffect, useMemo } from "react";
import { checksCover } from "../../../shared/checks";
import { checkedFile, problemMarkers } from "./editor-checks";
import type { ChecksController } from "./useProjectChecks";

/**
 * Hands the project's checks the unsaved buffer, a quarter second after the
 * last keystroke, and reads back this file's problems once they match it.
 */
export function useBufferChecks(
  checks: ChecksController,
  path: string,
  text: string | undefined,
  hash: string | undefined,
  onError: (error: unknown) => void,
) {
  const state = checks.state;
  const checked = checkedFile(state, path, hash);
  const problems = useMemo(
    () =>
      checked && state ? state.diagnostics.filter((d) => d.path === path) : [],
    [checked, state, path],
  );
  const markers = useMemo(() => problemMarkers(problems), [problems]);
  // A buffer the checks can't read would only make them recheck the project.
  const covered = checksCover(checks.target, path);
  useEffect(() => {
    if (text === undefined || !covered || !checks.enabled || !state?.id) return;
    const timer = setTimeout(() => {
      void checks.buffer(path, text).catch(onError);
    }, 250);
    return () => clearTimeout(timer);
  }, [text, path, covered, checks.enabled, state?.id]);
  useEffect(
    () => () => {
      if (covered) void checks.buffer(path, null).catch(() => {});
    },
    [path, covered, checks.buffer],
  );
  return { problems, markers };
}
