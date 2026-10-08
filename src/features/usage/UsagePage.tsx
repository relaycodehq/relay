// What the agents burned, counted from the threads on this computer and never
// sent anywhere. Reads like Settings: figures as text, one lavender chart a
// day, hairline rows for the rest; the share card is the same page in brief.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChartColumn, ImageDown } from "lucide-react";
import { agents } from "../../../shared/agents";
import {
  relayJobLabels,
  type UsageJob,
  type UsageRange,
  type UsageSummary,
} from "../../../shared/usage";
import { api } from "../../lib/api";
import { ErrorBox, Loading } from "../../ui/ui";
import { columnsOf, compact, dayLabel, hours, usd } from "./format";
import { ShareDialog } from "./ShareDialog";
import {
  Columns,
  HarnessMark,
  Heatmap,
  Rows,
  WeeklyLimit,
} from "./usage-charts";
import "./usage.css";

export function UsageTitle() {
  return (
    <div className="project-window-title">
      <ChartColumn size={14} />
      <strong>Usage</strong>
    </div>
  );
}

const ranges: { value: UsageRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
];

export function UsagePage() {
  const [range, setRange] = useState<UsageRange>(
    () =>
      (localStorage.getItem("relay-usage-range") as UsageRange | null) ?? "30d",
  );
  const [sharing, setSharing] = useState(false);
  const query = useQuery({
    queryKey: ["usage-summary", range],
    queryFn: () => api.usageSummary(range),
    placeholderData: (previous) => previous,
  });
  const summary = query.data;
  const pick = (r: UsageRange) => {
    localStorage.setItem("relay-usage-range", r);
    setRange(r);
  };
  return (
    <div className="us-page">
      <header className="us-head">
        <div>
          <h1>Usage</h1>
          <p>
            {summary && `${dayLabel(summary.from)} – ${dayLabel(summary.to)}. `}
            Counted from the threads on this computer; nothing leaves it.
          </p>
        </div>
        <div className="us-tools">
          <div className="us-range" role="radiogroup" aria-label="Period">
            {ranges.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={r.value === range}
                onClick={() => pick(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="us-share-button"
            disabled={!summary?.totals.tokens}
            onClick={() => setSharing(true)}
          >
            <ImageDown size={14} />
            Share image…
          </button>
        </div>
      </header>
      {query.error ? (
        <ErrorBox error={query.error} />
      ) : !summary ? (
        <Loading />
      ) : summary.since === undefined ? (
        <p className="us-empty">
          Nothing counted yet. Relay counts from here on: every answer, and the
          titles, commit messages and checks it asks agents for.
        </p>
      ) : (
        <Quiet summary={summary} />
      )}
      {sharing && summary && (
        <ShareDialog summary={summary} onClose={() => setSharing(false)} />
      )}
    </div>
  );
}

function Block({
  title,
  aside,
  children,
}: {
  title: string;
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

/** Dollars at list prices, or a note when some of the tokens had none. */
function priced(dollars: number, unpriced: boolean) {
  if (!unpriced) return usd(dollars);
  return dollars ? `${usd(dollars)} + unpriced` : "no list price";
}

function Quiet({ summary }: { summary: UsageSummary }) {
  const { totals, cards, perThread, windows, since = summary.from } = summary;
  const relayShare = totals.usd ? (totals.relayUsd / totals.usd) * 100 : 0;
  // Relay's jobs by dollars, unless nothing it ran had a price.
  const relayBy = totals.relayUsd ? "usd" : "tokens";
  return (
    <div className="us-quiet">
      {new Date(since).setHours(0, 0, 0, 0) > summary.from && (
        <p className="us-since">
          Counting since {dayLabel(since)}; earlier days weren’t recorded.
        </p>
      )}
      <div className="us-top">
        <div className="us-figure">
          <strong>{compact(totals.tokens)}</strong>
          <span>tokens</span>
        </div>
        <dl className="us-facts">
          <div>
            <dt>At API prices</dt>
            <dd>{usd(totals.usd)}</dd>
          </div>
          <div>
            <dt>Answers</dt>
            <dd>{totals.answers.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Threads</dt>
            <dd>{cards.started.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Agents working</dt>
            <dd>{hours(totals.agentMs)}</dd>
          </div>
        </dl>
      </div>
      <Columns days={columnsOf(summary.days)} height={110} />

      <Block title="Harnesses">
        <Rows
          rows={summary.harnesses}
          value={(h) => h.tokens}
          label={(h) => (
            <>
              <HarnessMark id={h.provider} />
              {agents[h.provider].name}
            </>
          )}
          detail={(h) =>
            `${h.answers.toLocaleString("en-US")} answers · ${priced(
              h.usd,
              summary.models.some(
                (m) => m.provider === h.provider && m.unpriced,
              ),
            )}`
          }
          format={compact}
          strong={(_, i) => i === 0}
        />
      </Block>

      <Block title="Models" aside={`${summary.models.length} used`}>
        <Rows
          rows={summary.models}
          value={(m) => m.tokens}
          label={(m) => (
            <>
              <HarnessMark id={m.provider} />
              {m.model}
            </>
          )}
          detail={(m) =>
            `${m.answers.toLocaleString("en-US")} answers · ${priced(m.usd, m.unpriced)}`
          }
          format={compact}
          strong={(_, i) => i === 0}
        />
      </Block>

      <div className="us-pair">
        <Block
          title="Weekly limit"
          aside={
            windows.opened > 0 &&
            `${windows.opened} five-hour ${windows.opened === 1 ? "window" : "windows"}, ${windows.ranOut} ran out`
          }
        >
          <WeeklyLimit points={summary.weekly} />
        </Block>
        <Block title="When agents worked">
          <Heatmap heat={summary.heat} />
        </Block>
      </div>

      <div className="us-pair">
        <Block title="Threads">
          <dl className="us-list">
            <div>
              <dt>Started</dt>
              <dd>{cards.started}</dd>
            </div>
            <div>
              <dt>Started by agents</dt>
              <dd>{cards.byAgents}</dd>
            </div>
            <div>
              <dt>Settled</dt>
              <dd>{cards.settled}</dd>
            </div>
            <div>
              <dt>Tokens per thread</dt>
              <dd>
                {compact(perThread.tokensAvg)}{" "}
                <small>median {compact(perThread.tokensMedian)}</small>
              </dd>
            </div>
            <div>
              <dt>Answers per thread</dt>
              <dd>{perThread.answersAvg.toFixed(1)}</dd>
            </div>
          </dl>
        </Block>
        <Block
          title="Relay’s own work"
          aside={
            totals.relayUsd > 0 &&
            `${usd(totals.relayUsd)}, ${relayShare.toFixed(1)}% of the total`
          }
        >
          {summary.jobs.length ? (
            <Rows
              rows={summary.jobs}
              value={(j) => j[relayBy]}
              label={(j) =>
                relayJobLabels[j.job as Exclude<UsageJob, "thread">]
              }
              detail={(j) => (j.runs ? `${j.runs} runs` : undefined)}
              format={relayBy === "usd" ? usd : compact}
            />
          ) : (
            <p className="us-empty">
              Nothing yet: no titles, commit messages or checks.
            </p>
          )}
        </Block>
      </div>

      {summary.threads.length > 0 && (
        <Block title="Busiest threads">
          <Rows
            rows={summary.threads}
            value={(t) => t.tokens}
            label={(t) => (
              <>
                <HarnessMark id={t.provider} />
                {t.title}
              </>
            )}
            detail={(t) => [t.project, usd(t.usd)].filter(Boolean).join(" · ")}
            format={compact}
            strong={(_, i) => i === 0}
          />
        </Block>
      )}
    </div>
  );
}
