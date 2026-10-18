import { useEffect, useMemo, useState } from "react";
import { useWindowFocused } from "../../lib/window-focus";
import { useCacheHeat } from "./cache-heat";
import { ContextWindowMeter } from "./ContextWindowMeter";
import "./composer-model-picker.css";

const TTL_MS = 60 * 60_000;
const SWAP_MS = 2500;
const WINDOW = 1_000_000;

const meaning = {
  fire: "Fire: the prompt cache is fresh, so your next message reuses it and uses less of your limit.",
  ice: "Ice: the prompt cache has expired, so your next message processes the whole context again.",
  off: "Off: the ring only shows how full the context window is.",
};

/**
 * The composer's context ring for the setting beside it: while fire and ice
 * are on, its cache turns fresh and expired in turn; off, it's the bare ring.
 * Hovering holds the state still, so its title matches what shows.
 */
export function CacheHeatDemo() {
  const on = useCacheHeat();
  const focused = useWindowFocused();
  const [fresh, setFresh] = useState(true);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    if (!on || !focused || hovered) return;
    const timer = setInterval(() => setFresh((f) => !f), SWAP_MS);
    return () => clearInterval(timer);
  }, [on, focused, hovered]);
  const at = useMemo(() => Date.now() - (fresh ? 0 : TTL_MS), [fresh]);
  return (
    <span
      className="cache-heat-demo"
      title={meaning[on ? (fresh ? "fire" : "ice") : "off"]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {/* Inert, so hovering shows the title rather than the meter's popover. */}
      <span className="composer-tools" inert aria-hidden>
        <ContextWindowMeter
          usage={{
            usedTokens: Math.round(WINDOW * 0.184),
            maxTokens: WINDOW,
            cache: { at, ttlMs: TTL_MS },
          }}
          provider="claude"
          compacting={false}
          compactDisabled
          onCompact={() => {}}
        />
      </span>
    </span>
  );
}
