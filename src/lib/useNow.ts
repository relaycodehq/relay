import { useEffect, useState } from "react";
import { useWindowFocused } from "./window-focus";

/** The current time, refreshed every `interval` ms. */
export function useNow(interval: number, ticking = true) {
  const focused = useWindowFocused();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!ticking || !focused) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval, focused, ticking]);
  return now;
}
