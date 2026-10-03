import { useEffect, useMemo } from "react";
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
  useEffect(() => {
    if (text === undefined || !checks.enabled || !state?.id) return;
    const timer = setTimeout(() => {
      void checks.buffer(path, text).catch(onError);
    }, 250);
    return () => clearTimeout(timer);
  }, [text, path, checks.enabled, state?.id]);
  useEffect(
    () => () => {
      void checks.buffer(path, null).catch(() => {});
    },
    [path, checks.buffer],
  );
  return { problems, markers };
}
