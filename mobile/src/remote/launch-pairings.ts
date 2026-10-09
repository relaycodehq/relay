/** How long the launch screen waits on the keystore before showing the app anyway. */
export const pairingsWait = 5_000;

/**
 * Reads the saved pairings while the launch screen holds, but never holds it
 * for good: a keystore that throws or hangs (a busy emulator, a broken key)
 * shows the app without its computers, and a late read still lands. Returns
 * the cleanup for the effect that starts it.
 */
export function readPairingsAtLaunch<T>(
  load: () => Promise<T>,
  on: { loaded: (value: T) => Promise<void> | void; ready: () => void },
  wait = pairingsWait,
) {
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    on.ready();
  };
  const timer = setTimeout(show, wait);
  void load()
    .then(on.loaded)
    .catch((e) => console.warn("Couldn't read this phone's pairings", e))
    .finally(() => {
      clearTimeout(timer);
      show();
    });
  return () => clearTimeout(timer);
}
