// The revolver quick switch's ratchet click, to try by ear.
// Open http://127.0.0.1:5177/previews/revolver-sound/
import "../_shared/desktop-stub";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/agents/composer-model-picker.css";
import "../_shared/quick-switch.css";
import { initAppearance } from "../../src/lib/appearance";
import { QuickSwitchHud } from "../../src/features/quick-switch/QuickSwitchHud";
import { quickItems, stepPreset } from "../../src/features/quick-switch/quick-switch";
import { playClick } from "../../src/features/quick-switch/revolver-sound";
import { catalog, samplePresets } from "../_shared/quick-switch-common";

initAppearance();

const items = quickItems(
  samplePresets.map((p) => ({
    id: p.id,
    provider: p.provider,
    model: p.model,
    reasoningEffort: p.effort,
    fast: !!p.fast,
  })),
  (provider) => catalog[provider].models,
);

/** A real overspin's click spacing, measured from the cylinder in the app. */
const overspinGaps = [21, 17, 17, 18, 19, 22, 25, 36, 40, 55, 98, 322];

function play(sequence: "tick" | "overspin") {
  if (sequence === "tick") return playClick();
  let at = performance.now() + 30;
  playClick(at);
  for (const gap of overspinGaps) playClick((at += gap));
}

function Preview() {
  const [state, setState] = useState({ at: 0, dir: 1 });
  const go = useCallback(
    (step: -1 | 1) =>
      setState((s) => ({ at: stepPreset(items.length, s.at, step, true), dir: step })),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(-1);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") go(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  return (
    <div className="qs-page">
      <div className="qs-switcher" aria-label="Play">
        <button type="button" onClick={() => play("tick")}>Tick</button>
        <button type="button" onClick={() => play("overspin")}>Overspin</button>
        <span className="qs-sample">Sample data · ← → turns it, past the ends overspins</span>
      </div>
      <div className="quick-switch-sample" data-style="revolver" style={{ width: 360 }}>
        <QuickSwitchHud
          style="revolver"
          open
          items={items}
          index={state.at}
          dir={state.dir}
          onPick={(at, dir) => setState({ at, dir: dir ?? (at < state.at ? -1 : 1) })}
        />
        <div className="quick-sample-composer" />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
