// The Usage page cut down: one $/tokens switch drives everything, the heatmap
// and weekly-limit chart are gone, rhythm shows as two timelines. Three
// directions on made-up sample data.
// Open http://127.0.0.1:5177/previews/usage-redesign/
import "../_shared/desktop-stub";
import {
  StrictMode,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ChartColumn,
  ChevronRight,
  GitPullRequest,
  ImageDown,
} from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "../../src/features/usage/usage.css";
import "../usage-stats/preview.css";
import "./usage-redesign.css";
import {
  initAppearance,
  setMode,
  useAppearance,
} from "../../src/lib/appearance";
import { agents, type AgentProvider } from "../../shared/agents";
import { compact, usd } from "../../src/features/usage/format";
import { HarnessMark } from "../../src/features/usage/usage-charts";
import { sample } from "./usage-redesign-data";

initAppearance();

type Metric = "usd" | "work";
type Variant = "a" | "b" | "c";

const fmt = (n: number, m: Metric) => (m === "usd" ? usd(n) : compact(n));
const providers = ["claude", "codex", "opencode", "cursor"] as const;
const dayTotal = (d: (typeof sample.days)[number], m: Metric) =>
  providers.reduce((n, p) => n + d[p][m], 0);
const total = (m: Metric) => sample.harnesses.reduce((n, h) => n + h[m], 0);
const cacheReads = sample.harnesses.reduce((n, h) => n + h.tok - h.work, 0);
const relayUsd = sample.jobs.reduce((n, j) => n + j.usd, 0);
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const longWeekdays = [
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
];
const threadTitles = [
  ["Phone low-data mode", "relay"],
  ["Overnight god-file refactor", "relay"],
  ["Agent host survives restarts", "relay"],
  ["Promo reel ribbon pass", "relay"],
  ["Checkout page invoices", "shop"],
];
const dayLabel = (key: string) =>
  new Date(`${key}T00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** The busiest run of `span` hours, wrapping past midnight. */
function primeTime(values: number[], span = 4) {
  let best = 0;
  let at = 0;
  for (let i = 0; i < 24; i++) {
    let sum = 0;
    for (let k = 0; k < span; k++) sum += values[(i + k) % 24];
    if (sum > best) [best, at] = [sum, i];
  }
  return at;
}
const inPrime = (h: number, start: number, span = 4) =>
  (h - start + 24) % 24 < span;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="us-range" role="radiogroup" aria-label={label}>
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

function Head({
  metric,
  setMetric,
}: {
  metric: Metric;
  setMetric: (m: Metric) => void;
}) {
  const [range, setRange] = useState("30d");
  return (
    <header className="us-head">
      <div>
        <h1>Usage</h1>
        <p>
          {dayLabel(sample.days[0].day)} – {dayLabel(sample.days.at(-1)!.day)} ·
          counting started {dayLabel(sample.days[0].day)} · only on this
          computer
        </p>
      </div>
      <div className="us-tools">
        <Segmented
          label="Measure"
          value={metric}
          onChange={setMetric}
          options={[
            { value: "usd", label: "$" },
            { value: "work", label: "Tokens" },
          ]}
        />
        <Segmented
          label="Period"
          value={range}
          onChange={setRange}
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "all", label: "All" },
          ]}
        />
        <button type="button" className="ur-icon" title="Share image…">
          <ImageDown size={15} />
        </button>
      </div>
    </header>
  );
}

function Hero({
  metric,
  size = "big",
}: {
  metric: Metric;
  size?: "big" | "small";
}) {
  return (
    <div className={`ur-hero ${size}`}>
      <div className="us-figure">
        <strong>{fmt(total(metric), metric)}</strong>
        <span>
          {metric === "usd"
            ? "at API list prices — what it would cost, not your bill"
            : `fresh tokens · plus ${compact(cacheReads)} re-read from cache`}
        </span>
      </div>
      <dl className="us-facts">
        <div>
          <dt>Answers</dt>
          <dd>{sample.answers.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Threads</dt>
          <dd>{sample.threads.toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Agents worked</dt>
          <dd>{sample.agentHours} h</dd>
        </div>
      </dl>
    </div>
  );
}

/** Columns with a hover readout; `on` marks the ones worth looking at. */
function Bars({
  values,
  labels,
  ticks,
  height,
  on,
  tip,
  sub,
}: {
  values: number[];
  labels: string[];
  ticks: (i: number) => string | null;
  height: number;
  on?: (i: number) => boolean;
  tip: (i: number) => ReactNode;
  /** A thin second track under the columns, scaled on its own. */
  sub?: { values: number[]; label: string };
}) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values) || 1;
  const subMax = sub ? Math.max(...sub.values) || 1 : 1;
  const step = width / values.length;
  const gap = Math.min(6, step * 0.28);
  const subH = sub ? 14 : 0;
  const axis = 18;
  return (
    <div
      className="us-chart ur-bars"
      ref={ref}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height + axis + (sub ? subH + 8 : 0)}>
          <line className="us-grid" x1={0} x2={width} y1={height} y2={height} />
          {values.map((v, i) => {
            const h = Math.max(v ? 2 : 0, (v / max) * (height - 6));
            const lit = hover === null ? (on ? on(i) : true) : hover === i;
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect
                  x={i * step}
                  y={0}
                  width={step}
                  height={height}
                  fill="transparent"
                />
                <rect
                  className={`ur-col${lit ? " on" : ""}`}
                  x={i * step + gap / 2}
                  y={height - h}
                  width={step - gap}
                  height={h}
                  rx={Math.min(3, (step - gap) / 3)}
                />
                {ticks(i) && (
                  <text
                    className="us-axis"
                    x={i * step + step / 2}
                    y={height + 13}
                    textAnchor="middle"
                  >
                    {ticks(i)}
                  </text>
                )}
                {sub && (
                  <rect
                    className="ur-sub"
                    x={i * step + gap / 2}
                    y={height + axis + 4 + subH * (1 - sub.values[i] / subMax)}
                    width={step - gap}
                    height={Math.max(1, subH * (sub.values[i] / subMax))}
                    rx={1}
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      {sub && <div className="ur-sub-label">{sub.label}</div>}
      {hover !== null && width > 0 && (
        <div
          className="ur-tip"
          style={{
            left: Math.min(Math.max(hover * step + step / 2, 70), width - 70),
          }}
        >
          <strong>{labels[hover]}</strong>
          {tip(hover)}
        </div>
      )}
    </div>
  );
}

function Daily({ metric, height = 96 }: { metric: Metric; height?: number }) {
  const values = sample.days.map((d) => dayTotal(d, metric));
  return (
    <Bars
      values={values}
      height={height}
      labels={sample.days.map((d) => dayLabel(d.day))}
      ticks={(i) => (i % 4 === 0 ? dayLabel(sample.days[i].day) : null)}
      tip={(i) => (
        <>
          {providers
            .filter((p) => sample.days[i][p][metric] > 0)
            .map((p) => (
              <span key={p}>
                <HarnessMark id={p} size={11} />
                {agents[p].name}
                <b>{fmt(sample.days[i][p][metric], metric)}</b>
              </span>
            ))}
        </>
      )}
    />
  );
}

function DayRhythm({
  metric,
  height = 110,
  minutes = true,
}: {
  metric: Metric;
  height?: number;
  minutes?: boolean;
}) {
  const values = sample.hours.map((h) => h[metric]);
  const prime = primeTime(values);
  return (
    <Bars
      values={values}
      height={height}
      on={(i) => inPrime(i, prime)}
      labels={sample.hours.map((_, i) => `${hh(i)}–${hh(i + 1)}`)}
      ticks={(i) => (i % 6 === 0 ? hh(i) : null)}
      tip={(i) => (
        <>
          <span>
            Average day<b>{fmt(sample.hours[i][metric], metric)}</b>
          </span>
          <span>
            Agents busy<b>{sample.hours[i].min} min</b>
          </span>
        </>
      )}
      sub={
        minutes
          ? { values: sample.hours.map((h) => h.min), label: "agents busy" }
          : undefined
      }
    />
  );
}

function WeekRhythm({
  metric,
  height = 110,
  minutes = true,
}: {
  metric: Metric;
  height?: number;
  minutes?: boolean;
}) {
  const values = sample.week.map((d) => d[metric]);
  const top = values.indexOf(Math.max(...values));
  return (
    <Bars
      values={values}
      height={height}
      on={(i) => i === top}
      labels={longWeekdays}
      ticks={(i) => weekdays[i]}
      tip={(i) => (
        <>
          <span>
            Average day<b>{fmt(sample.week[i][metric], metric)}</b>
          </span>
          <span>
            Agents busy<b>{Math.round(sample.week[i].min / 60)} h</b>
          </span>
          <span>
            Counted<b>{sample.week[i].n} days</b>
          </span>
        </>
      )}
      sub={
        minutes
          ? { values: sample.week.map((d) => d.min), label: "agents busy" }
          : undefined
      }
    />
  );
}

function rhythmSentence(metric: Metric) {
  const hours = sample.hours.map((h) => h[metric]);
  const prime = primeTime(hours);
  const week = sample.week.map((d) => d[metric]);
  const day = week.indexOf(Math.max(...week));
  return { from: hh(prime), to: hh(prime + 4), day: longWeekdays[day] };
}

function Block({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="us-block">
      <header>
        <h2>{title}</h2>
        {aside && <span>{aside}</span>}
      </header>
      {children}
    </section>
  );
}

type Row = {
  key: string;
  mark?: AgentProvider;
  label: ReactNode;
  detail?: string;
  value: number;
};

function Table({
  rows,
  metric,
  of,
  top = 4,
}: {
  rows: Row[];
  metric: Metric;
  of: number;
  top?: number;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top);
  const rest = sorted.slice(top);
  const restSum = rest.reduce((n, r) => n + r.value, 0);
  const shown: Row[] =
    open || rest.length <= 1
      ? sorted
      : [
          ...head,
          {
            key: "other",
            label: (
              <button
                type="button"
                className="ur-more"
                onClick={() => setOpen(true)}
              >
                {rest.length} more <ChevronRight size={12} />
              </button>
            ),
            value: restSum,
          },
        ];
  const max = sorted[0]?.value || 1;
  return (
    <table className="us-rows ur-rows">
      <tbody>
        {shown.map((r, i) => (
          <tr key={r.key} className={i === 0 ? "lead" : undefined}>
            <th>
              <span className="us-row-label">
                {r.mark && <HarnessMark id={r.mark} />}
                {r.label}
              </span>
              {r.detail && <small>{r.detail}</small>}
            </th>
            <td className="us-row-bar">
              <span
                style={{ width: `${Math.max(0.5, (r.value / max) * 100)}%` }}
              />
            </td>
            <td className="ur-share">
              {r.value / of >= 0.001
                ? `${((r.value / of) * 100).toFixed(r.value / of < 0.1 ? 1 : 0)}%`
                : "<0.1%"}
            </td>
            <td className="us-num">{fmt(r.value, metric)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const modelRows = (m: Metric): Row[] =>
  sample.models.map((x) => ({
    key: x.model,
    mark: x.provider as AgentProvider,
    label: x.model,
    value: x[m],
  }));
const harnessRows = (m: Metric): Row[] =>
  sample.harnesses.map((h) => ({
    key: h.provider,
    mark: h.provider as AgentProvider,
    label: agents[h.provider as AgentProvider].name,
    value: h[m],
  }));
const threadRows = (m: Metric): Row[] =>
  sample.topThreads.map((t, i) => ({
    key: `t${i}`,
    mark: "claude",
    label: <a className="ur-link">{threadTitles[i][0]}</a>,
    detail: threadTitles[i][1],
    value: t[m],
  }));
const jobLabels: Record<string, string> = {
  watch: "Watcher checks",
  title: "Thread titles",
  helper: "Other helpers",
  plugin: "Plugins",
  tldr: "Answer TLDRs",
};
const jobRows = (m: Metric): Row[] =>
  sample.jobs.map((j) => ({
    key: j.job,
    label: jobLabels[j.job] ?? j.job,
    value: j[m],
  }));

function Overhead() {
  return (
    <p className="ur-footnote">
      Relay’s own work — titles, watcher checks, helpers — came to{" "}
      {usd(relayUsd)}, {((relayUsd / total("usd")) * 100).toFixed(1)}% of it.
    </p>
  );
}

/* A — overview first: the number, the days, the rhythm, then where it went. */
function Overview({ metric }: { metric: Metric }) {
  const [by, setBy] = useState<"models" | "harnesses">("models");
  const s = rhythmSentence(metric);
  return (
    <div className="us-quiet">
      <Hero metric={metric} />
      <Daily metric={metric} />
      <Block title="Rhythm" aside={`Most ${s.from}–${s.to}, and on ${s.day}`}>
        <div className="ur-pair">
          <div>
            <h3 className="ur-sub-head">Through the day</h3>
            <DayRhythm metric={metric} />
          </div>
          <div>
            <h3 className="ur-sub-head">Through the week</h3>
            <WeekRhythm metric={metric} />
          </div>
        </div>
      </Block>
      <Block
        title="Where it went"
        aside={
          <Segmented
            label="Group by"
            value={by}
            onChange={setBy}
            options={[
              { value: "models", label: "Models" },
              { value: "harnesses", label: "Harnesses" },
            ]}
          />
        }
      >
        <Table
          key={by}
          rows={by === "models" ? modelRows(metric) : harnessRows(metric)}
          metric={metric}
          of={total(metric)}
        />
      </Block>
      <Block title="Busiest threads">
        <Table
          rows={threadRows(metric)}
          metric={metric}
          of={total(metric)}
          top={5}
        />
      </Block>
      <Overhead />
    </div>
  );
}

/* B — rhythm first: a sentence about you, the two timelines big, the rest brief. */
function RhythmFirst({ metric }: { metric: Metric }) {
  const s = rhythmSentence(metric);
  const models = [...sample.models].sort((a, b) => b[metric] - a[metric]);
  const all = total(metric);
  const head = models.slice(0, 4);
  const rest = all - head.reduce((n, m) => n + m[metric], 0);
  return (
    <div className="us-quiet">
      <p className="ur-lede">
        You vibe hardest{" "}
        <em>
          {s.from}–{s.to}
        </em>
        , and most on <em>{s.day}</em>.
      </p>
      <p className="ur-lede-sub">
        {fmt(all, metric)} {metric === "usd" ? "at API prices" : "fresh tokens"}{" "}
        · {sample.answers.toLocaleString("en-US")} answers · {sample.agentHours}{" "}
        h of agents working
      </p>
      <div className="ur-rhythm-big">
        <div>
          <h3 className="ur-sub-head">An average day</h3>
          <DayRhythm metric={metric} height={170} />
        </div>
        <div>
          <h3 className="ur-sub-head">An average week</h3>
          <WeekRhythm metric={metric} height={170} />
        </div>
      </div>
      <Block title="Day by day">
        <Daily metric={metric} height={56} />
      </Block>
      <Block title="Where it went">
        <div className="ur-stack" role="img" aria-label="Share by model">
          {head.map((m, i) => (
            <span
              key={m.model}
              style={{ flex: m[metric], opacity: 1 - i * 0.2 }}
            />
          ))}
          <span className="rest" style={{ flex: rest }} />
        </div>
        <ul className="ur-legend">
          {head.map((m) => (
            <li key={m.model}>
              <HarnessMark id={m.provider as AgentProvider} />
              {m.model}
              <b>{fmt(m[metric], metric)}</b>
            </li>
          ))}
          <li className="muted">
            {models.length - 4} others<b>{fmt(rest, metric)}</b>
          </li>
        </ul>
      </Block>
      <Block title="Busiest threads">
        <Table
          rows={threadRows(metric).slice(0, 3)}
          metric={metric}
          of={all}
          top={3}
        />
      </Block>
      <Overhead />
    </div>
  );
}

/* C — minimal: one chart slot with three lenses, one table with four tabs. */
function Lenses({ metric }: { metric: Metric }) {
  const [lens, setLens] = useState<"days" | "hours" | "week">("days");
  const [tab, setTab] = useState<"models" | "harnesses" | "threads" | "relay">(
    "models",
  );
  const s = rhythmSentence(metric);
  const rows = {
    models: modelRows,
    harnesses: harnessRows,
    threads: threadRows,
    relay: jobRows,
  }[tab](metric);
  return (
    <div className="us-quiet">
      <Hero metric={metric} />
      <Block
        title={
          lens === "days"
            ? "Day by day"
            : lens === "hours"
              ? `An average day · most ${s.from}–${s.to}`
              : `An average week · most on ${s.day}`
        }
        aside={
          <Segmented
            label="Lens"
            value={lens}
            onChange={setLens}
            options={[
              { value: "days", label: "Days" },
              { value: "hours", label: "Time of day" },
              { value: "week", label: "Weekday" },
            ]}
          />
        }
      >
        {lens === "days" ? (
          <Daily metric={metric} height={140} />
        ) : lens === "hours" ? (
          <DayRhythm metric={metric} height={140} minutes={false} />
        ) : (
          <WeekRhythm metric={metric} height={140} minutes={false} />
        )}
      </Block>
      <Block
        title="Breakdown"
        aside={
          <Segmented
            label="Breakdown"
            value={tab}
            onChange={setTab}
            options={[
              { value: "models", label: "Models" },
              { value: "harnesses", label: "Harnesses" },
              { value: "threads", label: "Threads" },
              { value: "relay", label: "Relay" },
            ]}
          />
        }
      >
        <Table
          key={tab}
          rows={rows}
          metric={metric}
          of={total(metric)}
          top={5}
        />
      </Block>
    </div>
  );
}

const variants: { value: Variant; label: string }[] = [
  { value: "a", label: "A · Overview" },
  { value: "b", label: "B · Rhythm first" },
  { value: "c", label: "C · Lenses" },
];

function App() {
  const kind = useAppearance().palette.kind;
  const [variant, setVariant] = useState<Variant>(
    () => (new URLSearchParams(location.search).get("v") as Variant) ?? "a",
  );
  const [metric, setMetric] = useState<Metric>("usd");
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <ChartColumn size={14} /> Usage redesign
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <span className="spacer" />
        <div
          className="preview-segmented"
          role="radiogroup"
          aria-label="Direction"
        >
          {variants.map((v) => (
            <button
              key={v.value}
              type="button"
              role="radio"
              aria-checked={variant === v.value}
              onClick={() => setVariant(v.value)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div
          className="preview-segmented"
          role="radiogroup"
          aria-label="Colour mode"
        >
          {(["light", "dark"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setMode(k)}
            >
              {k === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <aside className="preview-usage-sidebar">
          <div className="sb">
            <nav className="sb-nav">
              <button className="sb-nav-item">
                <GitPullRequest size={15} />
                Pull requests
              </button>
              <button className="sb-nav-item selected" aria-current="page">
                <ChartColumn size={15} />
                Usage
              </button>
            </nav>
          </div>
        </aside>
        <div className="us-page">
          <Head metric={metric} setMetric={setMetric} />
          {variant === "a" && <Overview metric={metric} />}
          {variant === "b" && <RhythmFirst metric={metric} />}
          {variant === "c" && <Lenses metric={metric} />}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
