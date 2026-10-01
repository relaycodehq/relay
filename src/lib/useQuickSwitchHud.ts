import { useEffect, useRef, useState } from "react";
import type { Recipient } from "../../shared/recipient";
import { presetIndex, stepPreset, useQuickSwitch } from "./quick-switch";
import type { AgentRuns } from "./useAgentRuns";

/**
 * Quick switch: with presets set up, ⌃⌘←/→ steps the composer through them,
 * and the switcher shows where it is until the pointer leaves it.
 */
export function useQuickSwitchHud(runs: AgentRuns, to: Recipient) {
  const quickSwitch = useQuickSwitch();
  const presets = quickSwitch.enabled ? quickSwitch.presets : [];
  const [hud, setHud] = useState({ open: false, at: -1, dir: 1 });
  const hovered = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hideSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!hovered.current) setHud((q) => ({ ...q, open: false }));
    }, 1400);
  };
  const pick = (at: number, dir: number) => {
    runs.applyPreset(presets[at]);
    setHud({ open: true, at, dir });
    hideSoon();
  };
  return {
    style: quickSwitch.style,
    presets,
    /** The switcher: whether it shows, the preset it's on and the way it went. */
    hud,
    pick,
    step(step: -1 | 1) {
      const run = runs.now(to);
      const from = run ? presetIndex(presets, run, hud.at) : -1;
      // The revolver goes on round past the ends; the other styles stop there.
      const wrap = quickSwitch.style === "revolver";
      const at = stepPreset(presets.length, from, step, wrap);
      if (at < 0) return;
      // At an end: show where you are without changing anything.
      if (at === from) {
        setHud({ open: true, at, dir: step });
        hideSoon();
      } else pick(at, step);
    },
    hover(over: boolean) {
      hovered.current = over;
      if (!over) hideSoon();
    },
  };
}
