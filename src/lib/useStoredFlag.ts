import { useEffect, useState } from "react";

/** A boolean kept per device in localStorage; `fallback` until it's first set. */
export function useStoredFlag(key: string, fallback = false) {
  const [on, setOn] = useState(() => {
    const saved = localStorage.getItem(key);
    return saved === null ? fallback : saved === "true";
  });
  useEffect(() => {
    localStorage.setItem(key, String(on));
  }, [key, on]);
  return [on, setOn] as const;
}
