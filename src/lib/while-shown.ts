/**
 * Calls `tick` every `ms` while the window shows, and once when it shows
 * again if it skipped one. A minimized window, or one behind a locked
 * screen, has nobody to show the result to; Query's own polls wait the same.
 * Returns the cleanup.
 */
export function everyWhileShown(tick: () => void, ms: number) {
  let missed = false;
  const timer = setInterval(() => {
    if (document.hidden) missed = true;
    else tick();
  }, ms);
  const shown = () => {
    if (!missed || document.hidden) return;
    missed = false;
    tick();
  };
  document.addEventListener("visibilitychange", shown);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", shown);
  };
}
