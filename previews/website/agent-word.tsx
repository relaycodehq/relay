import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { agentName, type AgentProvider } from "../../shared/agents";
import { reducedMotion } from "./motion";
import {
  buildCycle,
  clamp01,
  defaultTiming,
  type Frame,
  type ReelTiming,
} from "./reel";

// Marks from the ACP registry (cdn.agentclientprotocol.com), one colour each.
const registryMarks = import.meta.glob<string>("./agents/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});
// Recognisable names at the slow ends of the spin.
const registryAgents: [id: string, name: string][] = [
  ["github-copilot-cli", "GitHub Copilot"],
  ["gemini", "Gemini CLI"],
  ["goose", "goose"],
  ["cline", "Cline"],
  ["junie", "Junie"],
  ["qwen-code", "Qwen Code"],
  ["auggie", "Auggie CLI"],
  ["kilo", "Kilo"],
  ["qoder", "Qoder CLI"],
  ["mistral-vibe", "Mistral Vibe"],
  ["kimi", "Kimi CLI"],
  ["grok-build", "Grok Build"],
  ["devin", "Devin"],
  ["factory-droid", "Factory Droid"],
];

type Word = { key: string; name: string; icon: ReactNode };

const builtinWord = (provider: AgentProvider): Word => ({
  key: provider,
  name: agentName(provider),
  icon: <ProviderIcon provider={provider} />,
});
export const turning: Word[] = [
  ...(
    ["claude", "codex", "opencode", "cursor", "amp", "antigravity"] as const
  ).map(builtinWord),
  ...registryAgents.map(([id, name]) => ({
    key: id,
    name,
    icon: (
      <span
        className="registry-glyph"
        style={{ maskImage: `url("${registryMarks[`./agents/${id}.svg`]}")` }}
      />
    ),
  })),
];
turning.push({ key: "acp", name: "any ACP agent", icon: null });
// A copy of Claude ends the reel, so the loop can jump back to the start unseen.
const reel = [...turning, { ...turning[0], key: "seam" }];
export const acp = turning.length - 1;

/**
 * The headline's last line: Relay's agents and the ACP registry's on a reel
 * that spins up, settles on "any ACP agent" and rolls on to Claude.
 * `scrub` pins it to that many milliseconds into the loop; `onFrame` hears
 * where it is on every frame, holds included; `rate` slows it down.
 */
export function AgentWord({
  timing = defaultTiming,
  scrub = null,
  rate = 1,
  onFrame,
}: {
  timing?: ReelTiming;
  scrub?: number | null;
  rate?: number;
  onFrame?: (t: number, frame: Frame) => void;
}) {
  const word = useRef<HTMLSpanElement>(null);
  const strip = useRef<HTMLSpanElement>(null);
  const blur = useRef<SVGFEGaussianBlurElement>(null);
  const clock = useRef(0);
  const listener = useRef(onFrame);
  listener.current = onFrame;
  const [lit, setLit] = useState(0);
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (reducedMotion()) return;
    const cycle = buildCycle(timing, acp);
    const { blur: most, blurFrom } = timing;
    const peak = cycle.spin.peak;
    const show = (t: number) => {
      const frame = cycle.frame(t);
      strip.current!.style.transform = `translateY(${-frame.position * 1.2}em)`;
      const amount =
        peak > blurFrom
          ? most * clamp01((frame.speed - blurFrom) / (peak - blurFrom))
          : 0;
      word.current!.style.filter = amount > 0.05 ? "url(#hero-word-blur)" : "";
      blur.current!.setAttribute("stdDeviation", `0 ${amount}`);
      const moving = frame.phase === "spin" || frame.phase === "land";
      setSpinning(moving);
      setLit(frame.phase === "acp" ? acp : 0);
      listener.current?.(t, frame);
      return frame;
    };
    if (scrub !== null) {
      clock.current = scrub;
      show(scrub);
      return;
    }
    let frame = 0;
    let timer = 0;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      const resting = cycle.frame(clock.current).phase === "hold";
      // Nobody watches a window in the background; wait on Claude until they're back.
      if (!(resting && document.documentElement.dataset.inactive !== undefined))
        clock.current = (clock.current + (now - last) * rate) % cycle.ms;
      last = now;
      const { phase, left } = show(clock.current);
      // Rests sit still, so they sleep instead of drawing every frame.
      if (phase === "spin" || phase === "land" || listener.current)
        frame = requestAnimationFrame(tick);
      else timer = window.setTimeout(tick, Math.min(left / rate, 500));
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [timing, scrub, rate]);
  return (
    <span
      ref={word}
      className="hero-word"
      aria-label={`${turning
        .slice(0, 6)
        .map((w) => w.name)
        .join(", ")} and any ACP agent`}
    >
      <svg className="hero-word-filter" aria-hidden="true">
        <filter id="hero-word-blur" y="-20%" height="140%">
          <feGaussianBlur ref={blur} stdDeviation="0 0" />
        </filter>
      </svg>
      <span
        ref={strip}
        data-spinning={spinning || undefined}
        aria-hidden="true"
      >
        {reel.map((w, i) => (
          <span key={w.key} data-on={i === lit || undefined}>
            {w.icon}
            {w.name}
          </span>
        ))}
      </span>
    </span>
  );
}
