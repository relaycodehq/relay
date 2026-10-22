import { useEffect, useState } from "react";

/** A value that clears itself `ms` after it's set, for a moment's "Copied" or "Saved". */
export function useFlash<T = true>(ms: number) {
  const [value, setValue] = useState<T>();
  useEffect(() => {
    if (value === undefined) return;
    const timer = window.setTimeout(() => setValue(undefined), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return [value, setValue] as const;
}
