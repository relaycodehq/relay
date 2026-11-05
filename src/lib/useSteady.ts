import { useRef } from "react";

const sameFields = (a: object, b: object) => {
  const before = b as Record<string, unknown>;
  const entries = Object.entries(a);
  return (
    entries.length === Object.keys(b).length &&
    entries.every(([key, value]) => Object.is(value, before[key]))
  );
};

/**
 * The object a hook returns, kept as the one it returned last while every
 * field is the same, so memoized children it's passed to skip renders. Its
 * callbacks have to be stable for that (`useStableCallback`).
 */
export function useSteady<T extends object>(value: T): T {
  const last = useRef(value);
  if (!sameFields(value, last.current)) last.current = value;
  return last.current;
}
