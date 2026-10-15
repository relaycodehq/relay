import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import "./thread-windows.css";

const FLASH_MS = 1200;

/** Lights the window's edges when it's brought up, so it's found on another screen. */
export function WindowFlash() {
  const [flash, setFlash] = useState(0);
  useEffect(() => api.onFlashWindow(() => setFlash((n) => n + 1)), []);
  useEffect(() => {
    if (!flash) return;
    const done = setTimeout(() => setFlash(0), FLASH_MS);
    return () => clearTimeout(done);
  }, [flash]);
  // Keyed by the count, so a second click restarts the glow.
  return flash ? (
    <div key={flash} className="window-flash" aria-hidden="true" />
  ) : null;
}
