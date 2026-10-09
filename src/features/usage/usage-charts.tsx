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
  agentName,
  isRegistryProvider,
  type AgentProvider,
} from "../../../shared/agents";
import {
  providersIn,
  type UsageMeasure,
  type UsageSlot,
} from "../../../shared/usage";
import {
  Amp,
  Antigravity,
  ClaudeAI,
  OpenAI,
  OpenCode,
} from "../agents/ProviderLogos";
import { CursorGlyph } from "../agents/CursorGlyph";
import { RegistryGlyph } from "../agents/RegistryGlyph";
import {
  clock,
  dayLabel,
  dayTotal,
  longDay,
  measured,
  type UsageColumn,
} from "./format";
import { average, inStretch, weekdayNames } from "./rhythm";

export const providerLogos = {
  claude: ClaudeAI,
  codex: OpenAI,
  opencode: OpenCode,
  cursor: CursorGlyph,
  amp: Amp,
  antigravity: Antigravity,
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
  if (isRegistryProvider(id))
    return (
      <RegistryGlyph
        provider={id}
        className="us-mark"
        size={size}
        style={{ color: "currentColor", ...style }}
      />
    );
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

/** A rounded data end on top, square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const AXIS = 18;
const BUSY = 12;

/**
 * Columns with a readout on hover. `lit` picks the ones worth looking at, in
 * the accent; `busy` adds a thin grey track of agent-minutes, scaled on its own.
 */
function Bars({
  values,
  height,
  label,
  tick,
  lit = () => true,
  tip,
  busy,
}: {
  values: number[];
  height: number;
  label: string;
  tick: (i: number) => string | null;
  lit?: (i: number) => boolean;
  tip: (i: number) => ReactNode;
  busy?: number[];
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState(-1);
  const max = Math.max(1e-9, ...values);
  const busyMax = Math.max(1e-9, ...(busy ?? []));
  const slot = width / values.length;
  const barW = Math.min(28, slot * 0.72);
  const total = height + AXIS + (busy ? BUSY + 6 : 0);
  return (
    <div className="us-chart" ref={ref} onMouseLeave={() => setHover(-1)}>
      {width > 0 && (
        <svg width={width} height={total} role="img" aria-label={label}>
          <line x1={0} x2={width} y1={height} y2={height} className="us-grid" />
          {values.map((v, i) => {
            const h = (v / max) * (height - 4);
            const x = i * slot + (slot - barW) / 2;
            const on = hover < 0 ? lit(i) : hover === i;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect
                  x={i * slot}
                  y={0}
                  width={slot}
                  height={total}
                  fill="transparent"
                />
                {h > 0 && (
                  <path
                    d={topRounded(x, height - h, barW, Math.max(h, 2), 3)}
                    className={on ? "us-col on" : "us-col"}
                  />
                )}
                {tick(i) && (
                  <text
                    x={x + barW / 2}
                    y={height + 13}
                    className="us-axis"
                    textAnchor="middle"
                  >
                    {tick(i)}
                  </text>
                )}
                {busy && busy[i] > 0 && (
                  <rect
                    className="us-busy"
                    x={x}
                    y={total - (busy[i] / busyMax) * BUSY}
                    width={barW}
                    height={Math.max(1, (busy[i] / busyMax) * BUSY)}
                    rx={1}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {busy && <div className="us-busy-label">agents busy</div>}
      {hover >= 0 && (
        <div
          className="us-tip"
          role="status"
          style={{
            left: Math.max(
              0,
              Math.min(hover * slot + slot / 2 - 80, width - 170),
            ),
            top: -8,
          }}
        >
          {tip(hover)}
        </div>
      )}
    </div>
  );
}

/** One column a day, or a week once the period is long; the split by harness lives in the tooltip. */
export function DayColumns({
  days,
  measure,
  height = 56,
}: {
  days: UsageColumn[];
  measure: UsageMeasure;
  height?: number;
}) {
  const every = Math.ceil(days.length / 6);
  return (
    <Bars
      values={days.map((d) => dayTotal(d, measure))}
      height={height}
      label="Day by day"
      tick={(i) => (i % every === 0 ? dayLabel(days[i].day) : null)}
      tip={(i) => {
        const day = days[i];
        return (
          <>
            <strong>
              {day.last === day.day
                ? longDay(day.day)
                : `${dayLabel(day.day)} – ${dayLabel(day.last)}`}
            </strong>
            {providersIn(day[measure])
              .filter((p) => (day[measure][p] ?? 0) > 0)
              .sort((a, b) => day[measure][b]! - day[measure][a]!)
              .map((p) => (
                <span key={p}>
                  <HarnessMark id={p} size={11} />
                  {agentName(p)}
                  <b>{measured(day[measure][p]!, measure)}</b>
                </span>
              ))}
            <span className="us-tip-total">
              {day.answers} answers
              <b>{measured(dayTotal(day, measure), measure)}</b>
            </span>
          </>
        );
      }}
    />
  );
}

function SlotTip({
  title,
  slot,
  measure,
}: {
  title: string;
  slot: UsageSlot;
  measure: UsageMeasure;
}) {
  const busy = slot.days ? slot.minutes / slot.days : 0;
  return (
    <>
      <strong>{title}</strong>
      <span>
        On average<b>{measured(average(slot, measure), measure)}</b>
      </span>
      <span>
        Agents busy
        <b>
          {busy >= 90
            ? `${(busy / 60).toFixed(1)} h`
            : `${Math.round(busy)} min`}
        </b>
      </span>
    </>
  );
}

/** An average day, midnight to midnight, its busiest stretch in the accent. */
export function HourColumns({
  hours,
  measure,
  stretch,
  height,
}: {
  hours: UsageSlot[];
  measure: UsageMeasure;
  stretch: number | null;
  height: number;
}) {
  return (
    <Bars
      values={hours.map((h) => average(h, measure))}
      busy={hours.map((h) => h.minutes)}
      height={height}
      label="An average day"
      tick={(i) => (i % 6 === 0 ? clock(i) : null)}
      lit={(i) => stretch !== null && inStretch(i, stretch)}
      tip={(i) => (
        <SlotTip
          title={`${clock(i)}–${clock(i + 1)}`}
          slot={hours[i]}
          measure={measure}
        />
      )}
    />
  );
}

/** An average week, Monday first, its busiest day in the accent. */
export function WeekdayColumns({
  weekdays,
  measure,
  busiest,
  height,
}: {
  weekdays: UsageSlot[];
  measure: UsageMeasure;
  busiest: number | null;
  height: number;
}) {
  return (
    <Bars
      values={weekdays.map((d) => average(d, measure))}
      busy={weekdays.map((d) => (d.days ? d.minutes / d.days : 0))}
      height={height}
      label="An average week"
      tick={(i) => weekdayNames[i].slice(0, 3)}
      lit={(i) => i === busiest}
      tip={(i) => (
        <SlotTip
          title={`${weekdayNames[i]}s · ${weekdays[i].days} counted`}
          slot={weekdays[i]}
          measure={measure}
        />
      )}
    />
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
