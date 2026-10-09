// The image people share: the page's lede and its average day in one
// 1200×630 card. Colours are literal because an exported SVG can't read the
// app's CSS variables.
import { forwardRef } from "react";
import type { UsageSummary } from "../../../shared/usage";
import { relayMarkSvg, svgDataUrl } from "../../lib/relay-icon";
import type { ThemeKind } from "../../lib/themes";
import { clock, dayLabel, hours } from "./format";
import { average, headline, inStretch, rhythmLine } from "./rhythm";

const sans = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, sans-serif`;

const base = {
  light: {
    bg: "#ffffff",
    text: "#303237",
    muted: "#898b93",
    line: "#e2e3e6",
    accent: "#6565a9",
  },
  dark: {
    bg: "#1e1e21",
    text: "#e1e1e5",
    muted: "#94949f",
    line: "#37373d",
    accent: "#aaa8e5",
  },
};

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i] - v) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const clip = (text: string, most: number) =>
  text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text;

export type CardOptions = { names: boolean; dollars: boolean };

export const UsageCard = forwardRef<
  SVGSVGElement,
  { summary: UsageSummary; kind: ThemeKind; options: CardOptions }
>(function UsageCard({ summary, kind, options }, ref) {
  const c = base[kind];
  const m = options.dollars ? "usd" : "fresh";
  const W = 1200;
  const H = 630;
  const line = rhythmLine(summary, m);
  const values = summary.hours.map((h) => average(h, m));
  const max = Math.max(1e-9, ...values);
  const left = 60;
  const plotW = W - 2 * left;
  const slot = plotW / 24;
  const barW = slot * 0.7;
  const baseline = 520;
  const plotH = 170;
  const busiest = [...summary.threads].sort((a, b) => b[m] - a[m])[0];
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fontFamily={sans}
    >
      <rect width={W} height={H} fill={c.bg} />
      <image
        href={svgDataUrl(relayMarkSvg(c.accent))}
        x={left}
        y={52}
        width={26}
        height={26}
      />
      <text x={94} y={72} fill={c.text} fontSize={19} fontWeight={600}>
        Relay
      </text>
      <text x={W - left} y={72} fill={c.muted} fontSize={17} textAnchor="end">
        {dayLabel(summary.days[0]?.day ?? summary.from)} –{" "}
        {dayLabel(summary.to)}, {new Date(summary.to).getFullYear()}
      </text>

      <text
        x={left - 2}
        y={170}
        fill={c.text}
        fontSize={52}
        fontWeight={600}
        letterSpacing={-1.2}
      >
        You vibe hardest <tspan fill={c.accent}>{line.stretch}</tspan>
        {line.weekdays ? "," : "."}
      </text>
      {line.weekdays && (
        <text
          x={left - 2}
          y={234}
          fill={c.text}
          fontSize={52}
          fontWeight={600}
          letterSpacing={-1.2}
        >
          and most on <tspan fill={c.accent}>{line.weekdays}</tspan>.
        </text>
      )}
      <text x={left} y={line.weekdays ? 284 : 220} fill={c.muted} fontSize={20}>
        {headline(summary, m)} ·{" "}
        {summary.totals.answers.toLocaleString("en-US")} answers ·{" "}
        {hours(summary.totals.agentMs)} of agents working
      </text>

      <line
        x1={left}
        x2={W - left}
        y1={baseline}
        y2={baseline}
        stroke={c.line}
      />
      {values.map((v, i) => {
        const h = (v / max) * plotH;
        const lit = line.start !== null && inStretch(i, line.start);
        return (
          <g key={i}>
            {h > 0 && (
              <rect
                x={left + i * slot + (slot - barW) / 2}
                y={baseline - h}
                width={barW}
                height={h}
                rx={3}
                fill={lit ? c.accent : mix(c.bg, c.text, 0.16)}
              />
            )}
            {i % 6 === 0 && (
              <text
                x={left + i * slot + slot / 2}
                y={baseline + 22}
                fill={c.muted}
                fontSize={14}
                textAnchor="middle"
              >
                {clock(i)}
              </text>
            )}
          </g>
        );
      })}

      {options.names && busiest && (
        <text x={left} y={H - 40} fill={c.muted} fontSize={15}>
          Busiest thread: {clip(busiest.title, 48)}
          {busiest.project ? ` · ${clip(busiest.project, 24)}` : ""}
        </text>
      )}
      <text
        x={W - left}
        y={H - 40}
        fill={c.muted}
        fontSize={14}
        textAnchor="end"
      >
        Counted on this computer. Nothing was uploaded.
      </text>
    </svg>
  );
});

/** The card as a PNG data URL at 2x. The app's CSP allows data: images, not blob:. */
export async function cardPng(svg: SVGSVGElement): Promise<string> {
  const w = svg.width.baseVal.value;
  const h = svg.height.baseVal.value;
  const source = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = w * 2;
  canvas.height = h * 2;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}
