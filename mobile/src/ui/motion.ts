import { useEffect, useState } from "react";
import { AccessibilityInfo, AppState } from "react-native";

/** Endless animations run only while the app is in front, like the desktop's unfocused window. */
export function useForeground() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => sub.remove();
  }, []);
  return active;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => sub.remove();
  }, []);
  return reduced;
}

/** Ticks every `ms` while the app is in front and motion is allowed. */
export function useTick(ms: number, enabled = true) {
  const foreground = useForeground();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || !foreground) return;
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, enabled, foreground]);
  return tick;
}

/** The time, refreshed every `ms` while the app is in front and on coming back. */
export function useNow(ms: number) {
  const foreground = useForeground();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!foreground) return;
    const tick = () => setNow(Date.now());
    const back = setTimeout(tick, 0);
    const timer = setInterval(tick, ms);
    return () => {
      clearTimeout(back);
      clearInterval(timer);
    };
  }, [ms, foreground]);
  return now;
}
