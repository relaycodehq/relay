// The image people share: the Quiet page in one 1200×630 card. Colours are
// literal because an exported SVG can't read the app's CSS variables.
import { forwardRef } from "react";
import { agents } from "../../../shared/agents";
import type { UsageSummary } from "../../../shared/usage";
import { relayMarkSvg, svgDataUrl } from "../../lib/relay-icon";
import type { ThemeKind } from "../../lib/themes";
import { compact, columnsOf, dayLabel, dayTotal, hours, usd } from "./format";
import { heatLevel, providerLogos } from "./usage-charts";

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

/** Five steps from the surface to the accent, and a faint empty step. */
function heatFill(kind: ThemeKind, level: number) {
  const c = base[kind];
  return level === 0
    ? mix(c.bg, c.text, 0.07)
    : mix(c.bg, c.accent, [0, 0.22, 0.4, 0.58, 0.78, 1][level]);
}

const clip = (text: string, most: number) =>
  text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text;

export type CardOptions = { names: boolean; dollars: boolean };

export const UsageCard = forwardRef<
  SVGSVGElement,
  { summary: UsageSummary; kind: ThemeKind; options: CardOptions }
>(function UsageCard({ summary, kind, options }, ref) {
  const c = base[kind];
  const { totals } = summary;
  const W = 1200;
  const H = 630;
  const columns = columnsOf(summary.days);
  const max = Math.max(1, ...columns.map(dayTotal));
  const cw = 1080;
  const slot = cw / columns.length;
  const barW = Math.min(16, slot * 0.6);
  const heatMax = Math.max(...summary.heat.flat());
  const busiest = summary.threads[0];
  const facts = [
    ...(options.dollars ? [["At API prices", usd(totals.usd)]] : []),
    ["Answers", totals.answers.toLocaleString("en-US")],
    ["Threads", summary.cards.started.toLocaleString("en-US")],
    ["Agents working", hours(totals.agentMs)],
  ];
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
        x={60}
        y={52}
        width={26}
        height={26}
      />
      <text x={94} y={72} fill={c.text} fontSize={19} fontWeight={600}>
        Relay
      </text>
      <text x={W - 60} y={72} fill={c.muted} fontSize={17} textAnchor="end">
        {dayLabel(summary.from)} – {dayLabel(summary.to)},{" "}
        {new Date(summary.to).getFullYear()}
      </text>

      <text
        x={58}
        y={196}
        fill={c.text}
        fontSize={96}
        fontWeight={600}
        letterSpacing={-3}
      >
        {compact(totals.tokens)}
      </text>
      <text x={62} y={232} fill={c.muted} fontSize={20}>
        tokens
      </text>
      {facts.map(([label, value], i) => (
        <g key={label} transform={`translate(${560 + i * 150}, 150)`}>
          <text fill={c.muted} fontSize={14}>
            {label}
          </text>
          <text y={34} fill={c.text} fontSize={26} fontWeight={600}>
            {value}
          </text>
        </g>
      ))}
      {options.names && busiest && (
        <text x={560} y={232} fill={c.muted} fontSize={15}>
          Busiest thread: {clip(busiest.title, 48)}
          {busiest.project ? ` · ${clip(busiest.project, 24)}` : ""}
        </text>
      )}

      <line x1={60} x2={60 + cw} y1={400} y2={400} stroke={c.line} />
      {columns.map((d, i) => {
        const h = (dayTotal(d) / max) * 120;
        return (
          h > 0 && (
            <rect
              key={d.day}
              x={60 + i * slot + (slot - barW) / 2}
              y={400 - h}
              width={barW}
              height={h}
              rx={Math.min(3, barW / 2)}
              fill={c.accent}
            />
          )
        );
      })}

      {summary.harnesses.map((h, i) => {
        const Logo = providerLogos[h.provider];
        return (
          <g key={h.provider} transform={`translate(${60 + i * 170}, 460)`}>
            <Logo
              x={0}
              y={-14}
              width={16}
              height={16}
              style={{ fill: c.text }}
            />
            <text x={24} fill={c.text} fontSize={17}>
              {agents[h.provider].name}
            </text>
            <text x={24} y={26} fill={c.muted} fontSize={16}>
              {compact(h.tokens)}
            </text>
          </g>
        );
      })}

      {summary.heat.map((row, wd) =>
        row.map((v, hr) => (
          <rect
            key={`${wd}-${hr}`}
            x={W - 60 - 24 * 13 + hr * 13}
            y={446 + wd * 13}
            width={10}
            height={10}
            rx={2}
            fill={heatFill(kind, heatLevel(v, heatMax))}
          />
        )),
      )}
      <text x={W - 60} y={H - 40} fill={c.muted} fontSize={14} textAnchor="end">
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
