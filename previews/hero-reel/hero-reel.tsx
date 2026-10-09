// Tunes the website hero's agent reel on curves, like a graph editor: shape
// the speed and the clicks over the spin, scrub through the loop, then copy
// the settings into `defaultTiming` in previews/website/reel.ts.
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Copy, Pause, Play, RotateCcw } from "lucide-react";
import "../../src/styles.css";
import "../website/website.css";
import "./hero-reel.css";
import { initSiteTheme } from "../website/theme";
import { AgentWord, acp, turning } from "../website/agent-word";
import {
  buildCycle,
  defaultTiming,
  type CurvePoint,
  type Frame,
  type Handle,
  type Phase,
  type ReelTiming,
} from "../website/reel";
import { CurveLane, type LaneBox } from "./curve-lane";

initSiteTheme();

const KEY = "hero-reel:timing";

function load(): ReelTiming {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (saved && Array.isArray(saved.speed) && Array.isArray(saved.clicks))
      return { ...defaultTiming, ...saved };
  } catch {
    // Unreadable: start from the site's.
  }
  return defaultTiming;
}

const presets: { name: string; timing: ReelTiming }[] = [
  { name: "Site now", timing: defaultTiming },
  {
    name: "Steady build",
    timing: {
      ...defaultTiming,
      spin: 5.5,
      speed: [
        { t: 0, v: 0.06 },
        { t: 0.6, v: 0.72 },
        { t: 0.8, v: 1 },
        { t: 1, v: 0 },
      ],
      clicks: [
        { t: 0, v: 1 },
        { t: 0.25, v: 0.7 },
        { t: 0.42, v: 0 },
        { t: 1, v: 0 },
      ],
    },
  },
  {
    name: "Slot machine",
    timing: {
      ...defaultTiming,
      spin: 5,
      speed: [
        { t: 0, v: 0.25 },
        { t: 0.15, v: 1 },
        { t: 0.45, v: 0.85 },
        { t: 1, v: 0 },
      ],
      clicks: [
        { t: 0, v: 0 },
        { t: 0.7, v: 0 },
        { t: 1, v: 1 },
      ],
    },
  },
];

const phaseNames: Record<Phase, string> = {
  hold: "Claude",
  spin: "Spin",
  acp: "ACP",
  land: "Roll",
};

const round = (n: number) => Math.round(n * 1000) / 1000;
const roundHandle = (h?: Handle) => h && { t: round(h.t), v: round(h.v) };
const roundPoints = (points: CurvePoint[]) =>
  points.map((p) => ({
    t: round(p.t),
    v: round(p.v),
    ...(p.in && { in: roundHandle(p.in) }),
    ...(p.out && { out: roundHandle(p.out) }),
  }));

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function Field({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>
        {value}
        {unit}
      </output>
    </label>
  );
}

function Tuner() {
  const [timing, setTiming] = useState(load);
  const [scrub, setScrub] = useState<number | null>(null);
  const [rate, setRate] = useState(1);
  const [copied, setCopied] = useState(false);
  const [graph, width] = useWidth();
  const now = useRef(0);
  const loopHead = useRef<HTMLDivElement>(null);
  const graphHead = useRef<SVGLineElement>(null);
  const clockText = useRef<HTMLSpanElement>(null);
  const set = (patch: Partial<ReelTiming>) =>
    setTiming((current) => ({ ...current, ...patch }));
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(timing)), [timing]);

  const cycle = useMemo(() => buildCycle(timing, acp), [timing]);
  const { spin } = cycle;
  const spinStart = cycle.phases[1].start;

  const left = 104;
  const plot = Math.max(200, width - left - 72);
  const speedBox: LaneBox = { left, width: plot, top: 24, height: 210 };
  const clickBox: LaneBox = { left, width: plot, top: 266, height: 84 };
  const namesBox: LaneBox = { left, width: plot, top: 382, height: 150 };
  const rulerY = 556;
  const height = rulerY + 118;
  const x = (u: number) => left + u * plot;

  // When the reel reaches each name, and its path in names over the spin.
  const { crossings, path } = useMemo(() => {
    const crossings: { name: string; u: number }[] = [];
    const steps = 3000;
    let next = 1;
    const points: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const { position } = spin.at(u);
      while (next <= acp && position >= next - 0.01)
        crossings.push({ name: turning[next++].name, u });
      if (i % 5 === 0)
        points.push(
          `${i ? "L" : "M"}${(left + u * plot).toFixed(1)},${(
            namesBox.top +
            (1 - position / acp) * namesBox.height
          ).toFixed(1)}`,
        );
    }
    return { crossings, path: points.join("") };
  }, [spin, plot, namesBox.top, namesBox.height]);

  const onFrame = (t: number, frame: Frame) => {
    now.current = t;
    loopHead.current!.style.left = `${(t / cycle.ms) * 100}%`;
    const u = Math.min(1, Math.max(0, (t - spinStart) / spin.ms));
    graphHead.current!.setAttribute("x1", String(x(u)));
    graphHead.current!.setAttribute("x2", String(x(u)));
    graphHead.current!.dataset.away = frame.phase === "spin" ? "" : "true";
    clockText.current!.textContent = `${(t / 1000).toFixed(2)}s · ${
      phaseNames[frame.phase]
    } · ${frame.speed.toFixed(1)} names/s`;
  };

  const toggle = () =>
    setScrub((paused) => (paused === null ? now.current : null));
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const step =
          (event.shiftKey ? 100 : 1000 / 60) *
          (event.key === "ArrowLeft" ? -1 : 1);
        setScrub((now.current + step + cycle.ms) % cycle.ms);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scrubLoop = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const share = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    setScrub(share * cycle.ms);
  };
  const scrubSpin = (u: number) => setScrub(spinStart + u * spin.ms);

  const copy = async () => {
    const out: ReelTiming = {
      ...timing,
      speed: roundPoints(timing.speed),
      clicks: roundPoints(timing.clicks),
    };
    await navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="tuner">
      <div className="tuner-stage site">
        <span className="tuner-sample">Sample · the site's hero headline</span>
        <h1>
          One workspace for
          <AgentWord
            timing={timing}
            scrub={scrub}
            rate={rate}
            onFrame={onFrame}
          />
        </h1>
      </div>

      <div className="tuner-transport">
        <button type="button" className="tuner-play" onClick={toggle}>
          {scrub === null ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="tuner-rate">
          {[1, 0.5, 0.25].map((r) => (
            <button
              key={r}
              type="button"
              data-on={rate === r || undefined}
              onClick={() => setRate(r)}
            >
              {r}×
            </button>
          ))}
        </div>
        <span className="tuner-clock" ref={clockText} />
        <span className="tuner-stats">
          peak {spin.peak.toFixed(1)} names/s · loop{" "}
          {(cycle.ms / 1000).toFixed(1)}s
        </span>
        <div className="tuner-actions">
          {presets.map((preset) => (
            <button
              key={preset.name}
              type="button"
              onClick={() => setTiming(preset.timing)}
            >
              {preset.name}
            </button>
          ))}
          <button type="button" onClick={() => setTiming(defaultTiming)}>
            <RotateCcw size={13} /> Reset
          </button>
          <button type="button" className="tuner-copy" onClick={copy}>
            <Copy size={13} /> {copied ? "Copied" : "Copy settings"}
          </button>
        </div>
      </div>

      <div
        className="tuner-loop"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubLoop(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons) scrubLoop(event);
        }}
      >
        {cycle.phases.map((p) => (
          <div key={p.phase} data-phase={p.phase} style={{ flexGrow: p.ms }}>
            {phaseNames[p.phase]} {(p.ms / 1000).toFixed(2)}s
          </div>
        ))}
        <div className="tuner-loop-head" ref={loopHead} />
      </div>

      <div className="tuner-graph" ref={graph}>
        <svg width={width} height={height}>
          {crossings.map((c) => (
            <line
              key={c.name}
              className="crossing"
              x1={x(c.u)}
              x2={x(c.u)}
              y1={speedBox.top}
              y2={rulerY}
            />
          ))}
          <CurveLane
            box={speedBox}
            label="Speed"
            points={timing.speed}
            onChange={(speed) => set({ speed })}
            onScrub={scrubSpin}
            axis={(v) => `${(v * spin.scale).toFixed(1)}/s`}
            guide={{
              v: timing.blurFrom / spin.scale,
              label: "blur starts",
            }}
          />
          <CurveLane
            box={clickBox}
            label="Clicks"
            points={timing.clicks}
            onChange={(clicks) => set({ clicks })}
            onScrub={scrubSpin}
            axis={(v) => `${Math.round(v * 100)}%`}
          />
          <g className="lane">
            <rect
              className="lane-bed"
              x={namesBox.left}
              y={namesBox.top}
              width={namesBox.width}
              height={namesBox.height}
            />
            <text className="lane-label" x={left - 12} y={namesBox.top + 14}>
              Names
            </text>
            <path className="lane-position" d={path} />
          </g>
          <g className="ruler">
            <line x1={left} x2={left + plot} y1={rulerY} y2={rulerY} />
            {Array.from(
              { length: Math.floor(timing.spin * 2) + 1 },
              (_, i) => i / 2,
            ).map((s) => (
              <text key={s} x={x(s / timing.spin)} y={rulerY + 16}>
                {s}s
              </text>
            ))}
            {crossings.map((c) => (
              <text
                key={c.name}
                className="crossing-name"
                transform={`translate(${x(c.u) + 3.5}, ${rulerY + 26}) rotate(90)`}
              >
                {c.name}
              </text>
            ))}
          </g>
          <line
            ref={graphHead}
            className="graph-head"
            y1={speedBox.top - 8}
            y2={rulerY}
          />
        </svg>
      </div>

      <div className="tuner-fields">
        <Field
          label="Spin length"
          value={timing.spin}
          min={2}
          max={12}
          step={0.05}
          unit="s"
          onChange={(spin) => set({ spin })}
        />
        <Field
          label="Click rest"
          value={timing.pause}
          min={0}
          max={0.9}
          step={0.01}
          unit=""
          onChange={(pause) => set({ pause })}
        />
        <Field
          label="Blur at peak"
          value={timing.blur}
          min={0}
          max={8}
          step={0.1}
          unit="px"
          onChange={(blur) => set({ blur })}
        />
        <Field
          label="Blur starts at"
          value={timing.blurFrom}
          min={0}
          max={15}
          step={0.1}
          unit=" names/s"
          onChange={(blurFrom) => set({ blurFrom })}
        />
        <Field
          label="Rest on Claude"
          value={timing.hold}
          min={200}
          max={5000}
          step={50}
          unit="ms"
          onChange={(hold) => set({ hold })}
        />
        <Field
          label="Rest on ACP"
          value={timing.acpHold}
          min={200}
          max={5000}
          step={50}
          unit="ms"
          onChange={(acpHold) => set({ acpHold })}
        />
        <Field
          label="Roll to Claude"
          value={timing.land}
          min={150}
          max={2000}
          step={25}
          unit="ms"
          onChange={(land) => set({ land })}
        />
      </div>
      <p className="tuner-help">
        Drag a keyframe or its handles, Alt to move one handle alone ·
        double-click the lane to add a keyframe, a keyframe to drop it, a handle
        to make it smooth · press a lane or the loop bar to scrub · Space plays
        and pauses · ← → step a frame, with Shift 100ms
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Tuner />
  </StrictMode>,
);
