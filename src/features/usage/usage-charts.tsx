// The page's charts. One lavender for what matters, greys for the rest;
// harnesses are told apart by their logos and names, never by hue.
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  agentProviders,
  agents,
  type AgentProvider,
} from "../../../shared/agents";
import type { UsageSummary } from "../../../shared/usage";
import { ClaudeAI, OpenAI, OpenCode } from "../agents/ProviderLogos";
import { CursorGlyph } from "../agents/CursorGlyph";
import {
  compact,
  dayLabel,
  dayTotal,
  longDay,
  type UsageColumn,
} from "./format";

export const providerLogos = {
  claude: ClaudeAI,
  codex: OpenAI,
  opencode: OpenCode,
  cursor: CursorGlyph,
};

/** A provider's mark in the ink colour, never its brand colour. */
export function HarnessMark({
  id,
  size = 13,
  style,
}: {
  id: AgentProvider;
  size?: number;
  style?: CSSProperties;
}) {
  const Logo = providerLogos[id];
  return (
    <Logo
      className="us-mark"
      width={size}
      height={size}
      style={{ fill: "currentColor", ...style }}
    />
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type Tip = { x: number; y: number; body: ReactNode } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div className="us-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.body}
    </div>
  );
}

/** A rounded data end on top, square at the baseline. */
export function topRounded(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, h / 2, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** One column a day, one colour; the split by harness lives in the tooltip. */
export function Columns({
  days,
  height = 120,
}: {
  days: UsageColumn[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const [hover, setHover] = useState(-1);
  const plotH = height - 18;
  const max = Math.max(1, ...days.map(dayTotal));
  const slot = width / days.length;
  const barW = Math.min(14, slot * 0.6);
  const labelEvery = Math.ceil(days.length / 6);
  return (
    <div
      className="us-chart"
      ref={ref}
      onMouseLeave={() => {
        setTip(null);
        setHover(-1);
      }}
    >
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Tokens a day">
          <line x1={0} x2={width} y1={plotH} y2={plotH} className="us-grid" />
          {days.map((d, i) => {
            const h = (dayTotal(d) / max) * (plotH - 4);
            const x = i * slot + (slot - barW) / 2;
            return (
              <g
                key={d.day}
                onMouseEnter={() => {
                  setHover(i);
                  setTip({
                    x: Math.max(0, Math.min(x - 70, width - 170)),
                    y: -8,
                    body: <DayTip day={d} />,
                  });
                }}
              >
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={height}
                  fill="transparent"
                />
                {h > 0 && (
                  <path
                    d={topRounded(x, plotH - h, barW, h, 3)}
                    className={hover === i ? "us-col on" : "us-col"}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={x + barW / 2}
                    y={height - 3}
                    className="us-axis"
                    textAnchor="middle"
                  >
                    {dayLabel(d.day)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

function DayTip({ day }: { day: UsageColumn }) {
  return (
    <>
      <strong>
        {day.last === day.day
          ? longDay(day.day)
          : `${dayLabel(day.day)} – ${dayLabel(day.last)}`}
      </strong>
      {agentProviders
        .filter((p) => day.tokens[p] > 0)
        .sort((a, b) => day.tokens[b] - day.tokens[a])
        .map((p) => (
          <span key={p}>
            <HarnessMark id={p} size={11} />
            {agents[p].name}
            <b>{compact(day.tokens[p])}</b>
          </span>
        ))}
      <span className="us-tip-total">
        {day.answers} answers<b>{compact(dayTotal(day))}</b>
      </span>
    </>
  );
}

export const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Five steps up to the busiest hour, and an empty step. */
export function heatLevel(v: number, max: number) {
  return v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 5));
}

/** Agent-busy minutes by weekday and hour, surface to accent. */
export function Heatmap({ heat }: { heat: number[][] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(...heat.flat());
  const left = 30;
  const cell = Math.max(8, Math.min(18, (width - left) / 24 - 3));
  const step = cell + 3;
  const height = 7 * step + 16;
  return (
    <div className="us-chart" ref={ref} onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="When agents were working"
        >
          {heat.map((row, wd) => (
            <g key={wd}>
              <text
                x={left - 8}
                y={wd * step + cell - 2}
                className="us-axis"
                textAnchor="end"
              >
                {weekdays[wd][0]}
              </text>
              {row.map((v, h) => (
                <rect
                  key={h}
                  x={left + h * step}
                  y={wd * step}
                  width={cell}
                  height={cell}
                  rx={3}
                  className={`us-heat l${heatLevel(v, max)}`}
                  onMouseEnter={() =>
                    setTip({
                      x: Math.min(left + h * step + cell + 6, width - 150),
                      y: wd * step,
                      body: (
                        <>
                          <strong>
                            {weekdays[wd]} {String(h).padStart(2, "0")}:00
                          </strong>
                          <span>
                            Agents busy<b>{v} min</b>
                          </span>
                        </>
                      ),
                    })
                  }
                />
              ))}
            </g>
          ))}
          {[0, 6, 12, 18].map((h) => (
            <text
              key={h}
              x={left + h * step}
              y={height - 2}
              className="us-axis"
            >
              {String(h).padStart(2, "0")}
            </text>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

type LimitPoint = UsageSummary["weekly"][number];
const limitSeries = [
  { id: "claude", label: "Claude", cls: "us-line-a" },
  { id: "codex", label: "Codex", cls: "us-line-b" },
] as const;

/**
 * Weekly limit, Claude in the accent and Codex in grey, labelled at the ends.
 * Readings come only while Relay is open, so x is time, not reading count.
 */
export function WeeklyLimit({
  points,
  height = 130,
}: {
  points: LimitPoint[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [at, setAt] = useState(-1);
  const series = limitSeries.filter((s) => points.some((p) => p[s.id] != null));
  if (points.length < 2 || !series.length)
    return <p className="us-empty">No limit readings in this period yet.</p>;
  const top = 6;
  const right = 78;
  const plotH = height - top - 18;
  const plotW = Math.max(1, width - right);
  const first = points[0].at;
  const span = Math.max(1, points[points.length - 1].at - first);
  const x = (t: number) => ((t - first) / span) * plotW;
  const y = (v: number) => top + plotH - (Math.min(100, v) / 100) * plotH;
  // A reading holds until the next one: the limit only moves while agents
  // work, and a reset shows as a drop rather than a slope across the night.
  const path = (id: "claude" | "codex") => {
    let d = "";
    for (const p of points) {
      const v = p[id];
      if (v == null) continue;
      d += d
        ? `H${x(p.at).toFixed(1)}V${y(v).toFixed(1)}`
        : `M${x(p.at).toFixed(1)},${y(v).toFixed(1)}`;
    }
    return d;
  };
  const lastOf = (id: "claude" | "codex") =>
    [...points].reverse().find((p) => p[id] != null)?.[id] ?? 0;
  const ends = Object.fromEntries(
    series.map((s) => [s.id, y(lastOf(s.id)) + 4]),
  );
  if (series.length === 2) {
    // End labels sit on their lines, pushed apart when the lines end close.
    const mid = (ends.claude + ends.codex) / 2;
    const apart = Math.max(Math.abs(ends.claude - ends.codex), 14) / 2;
    const claudeAbove = lastOf("claude") >= lastOf("codex");
    ends.claude = mid + (claudeAbove ? -apart : apart);
    ends.codex = mid + (claudeAbove ? apart : -apart);
  }
  const p = at >= 0 ? points[at] : null;
  return (
    <div
      className="us-chart"
      ref={ref}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const t = first + ((e.clientX - r.left) / plotW) * span;
        if (t > first + span) return setAt(-1);
        let best = 0;
        for (let i = 1; i < points.length; i++)
          if (Math.abs(points[i].at - t) < Math.abs(points[best].at - t))
            best = i;
        setAt(best);
      }}
      onMouseLeave={() => setAt(-1)}
    >
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Weekly limit used"
        >
          <line x1={0} x2={plotW} y1={y(100)} y2={y(100)} className="us-grid" />
          <line x1={0} x2={plotW} y1={y(0)} y2={y(0)} className="us-grid" />
          <text x={0} y={y(100) - 4} className="us-axis">
            100%
          </text>
          {series.map((s) => (
            <path key={s.id} d={path(s.id)} className={s.cls} />
          ))}
          {series.map((s) => (
            <text
              key={s.id}
              x={plotW + 8}
              y={ends[s.id]}
              className="us-end-label"
            >
              {s.label} {Math.round(lastOf(s.id))}%
            </text>
          ))}
          <text x={0} y={height - 2} className="us-axis">
            {dayLabel(first)}
          </text>
          <text x={plotW} y={height - 2} className="us-axis" textAnchor="end">
            {dayLabel(first + span)}
          </text>
          {p && (
            <g>
              <line
                x1={x(p.at)}
                x2={x(p.at)}
                y1={top}
                y2={top + plotH}
                className="us-crosshair"
              />
              {series.map((s) => {
                const v = p[s.id];
                return (
                  v != null && (
                    <circle
                      key={s.id}
                      cx={x(p.at)}
                      cy={y(v)}
                      r={4}
                      className={`us-dot ${s.cls}`}
                    />
                  )
                );
              })}
            </g>
          )}
        </svg>
      )}
      {p && (
        <Tooltip
          tip={{
            x: Math.min(x(p.at) + 10, width - 160),
            y: 0,
            body: (
              <>
                <strong>
                  {longDay(p.at)},{" "}
                  {new Date(p.at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </strong>
                {series.map((s) => (
                  <span key={s.id}>
                    {s.label}
                    <b>{p[s.id] == null ? "–" : `${Math.round(p[s.id]!)}%`}</b>
                  </span>
                ))}
              </>
            ),
          }}
        />
      )}
    </div>
  );
}

/** Label, a hairline bar and the value; the table and the chart in one. */
export function Rows<T>({
  rows,
  value,
  label,
  detail,
  format,
  strong,
}: {
  rows: T[];
  value: (r: T) => number;
  label: (r: T) => ReactNode;
  detail?: (r: T) => ReactNode;
  format: (v: number) => string;
  strong?: (r: T, i: number) => boolean;
}) {
  const max = Math.max(0, ...rows.map(value));
  return (
    <table className="us-rows">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className={strong?.(r, i) ? "lead" : undefined}>
            <th scope="row">
              <span className="us-row-label">{label(r)}</span>
              {detail && <small>{detail(r)}</small>}
            </th>
            <td className="us-row-bar">
              <span
                style={{
                  width: `${max ? Math.max(0.8, (value(r) / max) * 100) : 0.8}%`,
                }}
              />
            </td>
            <td className="us-num">{format(value(r))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
