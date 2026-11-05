import { useRef } from "react";

/**
 * `value`, or the one returned last while it reads the same as JSON. Small
 * plain data rebuilt on every render keeps its identity, so a memoized child
 * it goes to skips the render. Not for functions, or anything big.
 */
export function useSteadyValue<T>(value: T): T {
  const last = useRef<{ value: T; json: string }>(undefined);
  const json = JSON.stringify(value) ?? "";
  if (last.current?.json !== json) last.current = { value, json };
  return last.current.value;
}
