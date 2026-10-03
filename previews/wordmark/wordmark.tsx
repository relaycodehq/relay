// Draft "Relay" wordmark: the real R from assets/relay-mark.svg, with "elay"
// drawn as the same ribbon by previews/wordmark/wordmark-ribbon.ts.
// Open http://127.0.0.1:5177/previews/wordmark/
import { StrictMode, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../_shared/chrome.css";
import "./wordmark.css";
import { initAppearance } from "../../src/lib/appearance";
import { relayMarkSvg } from "../../src/lib/relay-icon";
import { luminance, mix } from "../../src/lib/themes";
import { bounds, ribbon, type RibbonStep } from "./wordmark-ribbon";
import { RelayMark } from "../../src/ui/RelayMark";
import { joined, swash } from "./wordmark-letters";

initAppearance();

/** The ribbon group's placement inside relay-mark.svg's 1024 box. */
const MARK_SCALE = 1.42;
const MARK_X = 119.698;
const MARK_Y = 67.7136;
const R_BOX = { x0: 109, y0: 64, x1: 505, y1: 507 };

type Option = "joined" | "swash" | "type";

const options: { value: Option; label: string; note: string }[] = [
  {
    value: "joined",
    label: "Ribbon",
    note: "elay drawn as the R's ribbon: out of the leg's curl, folds where the a and y turn, the y's tail flicks right.",
  },
  {
    value: "swash",
    label: "Ribbon + swash",
    note: "Same letters; the y's tail sweeps back under the word like a signature and thins out beneath the e.",
  },
  {
    value: "type",
    label: "Mark + type",
    note: "For comparison: the R mark beside Relay set in the app's font. Holds up at titlebar size, where the ribbon can't.",
  },
];

const strokesFor: Record<Exclude<Option, "type">, RibbonStep[][]> = {
  joined,
  swash,
};

const backgrounds = [
  { value: "tile", label: "Icon tile", color: "#0c0c10" },
  { value: "dark", label: "App dark", color: "#1e1e21" },
  { value: "light", label: "App light", color: "#ffffff" },
] as const;
type Background = (typeof backgrounds)[number]["value"];

const accents = [
  { label: "Relay", color: "#aaa8e5" },
  { label: "Relay light", color: "#6565a9" },
  { label: "Dracula", color: "#bd93f9" },
  { label: "Tokyo Night", color: "#7aa2f7" },
  { label: "Nord", color: "#88c0d0" },
  { label: "Rosé Pine", color: "#ebbcba" },
  { label: "Gruvbox", color: "#fabd2f" },
];

// Shadow → highlight, taken from the R's own gradient stops.
const RAMP: [number, number[]][] = [
  [0, [104, 94, 150]],
  [0.25, [140, 124, 211]],
  [0.45, [164, 149, 228]],
  [0.65, [198, 188, 241]],
  [0.82, [226, 218, 255]],
  [1, [245, 243, 255]],
];

function rampHex(shade: number) {
  const i = RAMP.findIndex(([at]) => at >= shade);
  const [a, from] = RAMP[Math.max(0, i - 1)];
  const [b, to] = RAMP[Math.max(0, i)];
  const u = b === a ? 0 : (shade - a) / (b - a);
  return (
    "#" +
    from
      .map((v, k) =>
        Math.round(v + (to[k] - v) * u)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

// Copied from src/lib/relay-icon.ts so the letters follow the accent exactly
// as the R's gradient stops do.
const PIVOT = 0.62;
function tint(original: string, accent: string) {
  const l = luminance(original);
  return l >= PIVOT
    ? mix("#ffffff", accent, Math.min(0.92, (l - PIVOT) * 2.6))
    : mix("#000000", accent, Math.min(0.45, (PIVOT - l) * 1.6));
}

const STEPS = 64;
function shades(accent: string) {
  return Array.from({ length: STEPS + 1 }, (_, i) =>
    tint(rampHex(i / STEPS), accent),
  );
}

function markBody(accent: string) {
  return relayMarkSvg(accent)
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
}

function Wordmark({
  strokes,
  accent,
  height,
}: {
  strokes: RibbonStep[][];
  accent: string;
  height: number;
}) {
  const pieces = useMemo(() => strokes.map((s) => ribbon(s)), [strokes]);
  const viewBox = useMemo(() => {
    const box = { ...R_BOX };
    for (const b of pieces.map(bounds)) {
      box.x0 = Math.min(box.x0, b.x0);
      box.y0 = Math.min(box.y0, b.y0);
      box.x1 = Math.max(box.x1, b.x1);
      box.y1 = Math.max(box.y1, b.y1);
    }
    const pad = 6;
    const x = MARK_SCALE * (box.x0 - pad) + MARK_X;
    const y = MARK_SCALE * (box.y0 - pad) + MARK_Y;
    const w = MARK_SCALE * (box.x1 - box.x0 + 2 * pad);
    const h = MARK_SCALE * (box.y1 - box.y0 + 2 * pad);
    return `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }, [pieces]);
  const colors = useMemo(() => shades(accent), [accent]);
  const mark = useMemo(() => markBody(accent), [accent]);

  return (
    <svg viewBox={viewBox} height={height} role="img" aria-label="Relay">
      <g dangerouslySetInnerHTML={{ __html: mark }} />
      <g
        transform={`matrix(${MARK_SCALE},0,0,${MARK_SCALE},${MARK_X},${MARK_Y})`}
      >
        {pieces.flat().map((p, i) => {
          const c = colors[Math.round(p.shade * STEPS)];
          return (
            <path
              key={i}
              d={p.d}
              fill={c}
              stroke={c}
              strokeWidth={0.7}
              strokeLinejoin="round"
            />
          );
        })}
      </g>
    </svg>
  );
}

function Lockup({
  accent,
  height,
  dark,
}: {
  accent: string;
  height: number;
  dark: boolean;
}) {
  return (
    <span
      className="wm-lockup"
      style={{
        height,
        fontSize: height * 0.62,
        color: dark ? "#ecebf5" : "#26262c",
      }}
    >
      <RelayMark size={height} accent={accent} />
      Relay
    </span>
  );
}

function Logo({
  option,
  accent,
  height,
  dark,
}: {
  option: Option;
  accent: string;
  height: number;
  dark: boolean;
}) {
  return option === "type" ? (
    <Lockup accent={accent} height={height} dark={dark} />
  ) : (
    <Wordmark strokes={strokesFor[option]} accent={accent} height={height} />
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function App() {
  const params = new URLSearchParams(location.search);
  const [option, setOption] = useState<Option>(
    (params.get("option") as Option) ?? "joined",
  );
  const [background, setBackground] = useState<Background>(
    (params.get("bg") as Background) ?? "tile",
  );
  const [accent, setAccent] = useState(
    params.get("accent") ?? accents[0].color,
  );
  const bg = backgrounds.find((b) => b.value === background)!.color;
  const dark = background !== "light";

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>Relay wordmark</strong>
        <span className="preview-tag">Preview · draft lettering</span>
        <div className="preview-control">
          <span>Lettering</span>
          <Segmented<Option>
            label="Lettering"
            value={option}
            onChange={setOption}
            options={options.map(({ value, label }) => ({ value, label }))}
          />
        </div>
        <div className="preview-control">
          <span>Background</span>
          <Segmented<Background>
            label="Background"
            value={background}
            onChange={setBackground}
            options={backgrounds.map(({ value, label }) => ({ value, label }))}
          />
        </div>
        <div className="preview-control">
          <span>Accent</span>
          <div className="wm-accents" role="radiogroup" aria-label="Accent">
            {accents.map((a) => (
              <button
                key={a.color}
                type="button"
                role="radio"
                aria-checked={a.color === accent}
                aria-label={a.label}
                title={a.label}
                style={{ background: a.color }}
                onClick={() => setAccent(a.color)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="wm-stage" style={{ background: bg }}>
        <div className="wm-hero">
          <Logo
            option={option}
            accent={accent}
            height={option === "type" ? 160 : 360}
            dark={dark}
          />
        </div>
        <div className="wm-sizes">
          {[20, 32, 64, 120].map((h) => (
            <figure key={h}>
              <Logo
                option={option}
                accent={accent}
                height={option === "type" ? Math.round(h * 0.6) : h}
                dark={dark}
              />
              <figcaption>{h}px tall</figcaption>
            </figure>
          ))}
        </div>
      </div>
      <p className="wm-note">{options.find((o) => o.value === option)!.note}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
