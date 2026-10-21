// What the agents burned, counted from the threads on this computer and never
// sent anywhere. Leads with when you work, then how much and on what; one
// switch between dollars and fresh tokens drives every figure.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ImageDown } from "lucide-react";
import type {
  UsageMeasure,
  UsageRange,
  UsageSummary,
} from "../../../shared/usage";
import { relayJobLabels, usageRanges } from "../../../shared/usage";
import { api } from "../../lib/api";
import { useStoredChoice } from "../../lib/persisted-store";
import { ErrorBox, IconButton, Loading } from "../../ui/ui";
import { columnsOf, dayLabel, hours, measured } from "./format";
import { DAYS_FOR_A_WEEKDAY, headline, rhythmLine } from "./rhythm";
import { RoomLeft } from "./room/RoomLeft";
import { useRoom } from "./room/useRoom";
import { ShareDialog } from "./ShareDialog";
import {
  DayColumns,
  HarnessMark,
  HourColumns,
  Rows,
  WeekdayColumns,
} from "./usage-charts";
import "./usage.css";

export function UsageTitle({ onBack }: { onBack: () => void }) {
  return (
    <div className="project-window-title">
      <IconButton label="Back" onClick={onBack}>
        <ArrowLeft size={15} />
      </IconButton>
      <strong>Usage</strong>
    </div>
  );
}

const ranges: { value: UsageRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
];

const measures: { value: UsageMeasure; label: string }[] = [
  { value: "usd", label: "$" },
  { value: "fresh", label: "Tokens" },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
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

export function UsagePage({
  onOpenChat,
}: {
  onOpenChat: (projectId: string, chatId: string) => void;
}) {
  const [range, setRange] = useStoredChoice(
    "relay-usage-range",
    usageRanges,
    "30d",
  );
  const [measure, setMeasure] = useStoredChoice<UsageMeasure>(
    "relay-usage-measure",
    ["usd", "fresh"],
    "usd",
  );
  const [sharing, setSharing] = useState(false);
  const query = useQuery({
    queryKey: ["usage-summary", range],
    queryFn: () => api.usageSummary(range),
    placeholderData: (previous) => previous,
  });
  const summary = query.data;
  const period = summary && periodLabel(summary);
  return (
    <div className="us-page">
      <header className="us-head">
        <div>
          <h1>Usage</h1>
          <p>
            {period && `${period}. `}
            Only on this computer; nothing leaves it.
          </p>
        </div>
        <div className="us-tools">
          <Segmented
            label="Measure"
            value={measure}
            options={measures}
            onChange={setMeasure}
          />
          <Segmented
            label="Period"
            value={range}
            options={ranges}
            onChange={setRange}
          />
          <button
            type="button"
            className="us-share-button"
            title="Share image…"
            aria-label="Share image…"
            disabled={!summary?.totals.tokens}
            onClick={() => setSharing(true)}
          >
            <ImageDown size={15} />
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
        <Rhythmic summary={summary} measure={measure} onOpenChat={onOpenChat} />
      )}
      {sharing && summary && (
        <ShareDialog
          summary={summary}
          measure={measure}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

/** "Oct 2 – Oct 11", one day once, and when counting began inside the range. */
function periodLabel(summary: UsageSummary) {
  const first = dayLabel(summary.days[0]?.day ?? summary.from);
  const last = dayLabel(summary.to);
  const since =
    summary.since !== undefined &&
    new Date(summary.since).setHours(0, 0, 0, 0) > summary.from
      ? dayLabel(summary.since)
      : undefined;
  return (
    (first === last ? first : `${first} – ${last}`) +
    (since && since !== first ? `, counted since ${since}` : "")
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

const OTHERS_AFTER = 4;
/** Accounts that fit beside the rhythm charts; more get a row of their own. */
const ROOM_BESIDE = 4;

/** A label as it reads mid-sentence: "Thread titles" to "thread titles", "PR triage" as is. */
const midSentence = (label: string) =>
  label.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());

function Rhythmic({
  summary,
  measure: m,
  onOpenChat,
}: {
  summary: UsageSummary;
  measure: UsageMeasure;
  onOpenChat: (projectId: string, chatId: string) => void;
}) {
  const { totals } = summary;
  const line = rhythmLine(summary, m);
  const counted = summary.days.length;
  const models = [...summary.models]
    .filter((x) => x[m] > 0)
    .sort((a, b) => b[m] - a[m]);
  // One leftover model is shown, not folded into "1 other".
  const shown = models.slice(
    0,
    models.length === OTHERS_AFTER + 1 ? models.length : OTHERS_AFTER,
  );
  const rest = models.slice(shown.length).reduce((n, x) => n + x[m], 0);
  const speeds = summary.models
    .flatMap((x) => (x.speed ? [{ ...x, speed: x.speed }] : []))
    .sort((a, b) => b.speed.tps - a.speed.tps);
  const threads = [...summary.threads]
    .filter((t) => t[m] > 0)
    .sort((a, b) => b[m] - a[m])
    .slice(0, 3);
  const relay = m === "usd" ? totals.relayUsd : totals.relayFresh;
  const room = useRoom();
  const rooms = room.accounts.length;
  return (
    <div className="us-rhythmic">
      <p className="us-lede">
        {line.stretch ? (
          <>
            You vibe hardest <em>{line.stretch}</em>
            {line.weekdays && (
              <>
                , and most on <em>{line.weekdays}</em>
              </>
            )}
            .
          </>
        ) : totals.answers > 0 ? (
          m === "fresh" ? (
            "These answers came without token counts, so there's nothing to chart."
          ) : totals.tokens > 0 ? (
            "These answers came without a price; Tokens shows what they used."
          ) : (
            "These answers came without a price or token counts, so there's nothing to chart."
          )
        ) : (
          "A quiet stretch: nothing counted in these days."
        )}
      </p>
      <p className="us-lede-facts">
        {headline(summary, m)} · {totals.answers.toLocaleString("en-US")}{" "}
        answers · {hours(totals.agentMs)} of agents working
      </p>

      <div
        className={
          rooms
            ? `us-rhythm with-room${rooms > ROOM_BESIDE ? " wide-room" : ""}`
            : "us-rhythm"
        }
      >
        <div>
          <h3>An average day</h3>
          <HourColumns
            hours={summary.hours}
            measure={m}
            stretch={line.start}
            height={170}
          />
        </div>
        <div>
          <h3>An average week</h3>
          <WeekdayColumns
            weekdays={summary.weekdays}
            measure={m}
            busiest={line.weekday}
            height={170}
          />
          {counted < DAYS_FOR_A_WEEKDAY && (
            <p className="us-rhythm-note">
              {counted} {counted === 1 ? "day" : "days"} so far; names a day
              after two weeks
            </p>
          )}
        </div>
        {rooms > 0 && <RoomLeft room={room} />}
      </div>

      <Block title="Day by day">
        <DayColumns days={columnsOf(summary.days)} measure={m} />
      </Block>

      {models.length > 0 && (
        <Block title="Where it went">
          <div className="us-stack" role="img" aria-label="Share by model">
            {shown.map((x, i) => (
              <span
                key={`${x.provider}|${x.model}`}
                style={{ flex: x[m], opacity: 1 - i * 0.2 }}
              />
            ))}
            {rest > 0 && <span className="rest" style={{ flex: rest }} />}
          </div>
          <ul className="us-legend">
            {shown.map((x) => (
              <li key={`${x.provider}|${x.model}`}>
                <HarnessMark id={x.provider} />
                {x.model}
                <b>
                  {measured(x[m], m)}
                  {m === "usd" && x.unpriced && " + unpriced"}
                </b>
              </li>
            ))}
            {rest > 0 && (
              <li
                className="muted"
                title={models
                  .slice(shown.length)
                  .map((x) => `${x.model}: ${measured(x[m], m)}`)
                  .join("\n")}
              >
                {models.length - shown.length} others<b>{measured(rest, m)}</b>
              </li>
            )}
          </ul>
        </Block>
      )}

      {speeds.length > 0 && (
        <Block title="How fast they write" aside="median, without thinking">
          <Rows
            rows={speeds}
            value={(x) => x.speed.tps}
            label={(x) => (
              <>
                <HarnessMark id={x.provider} />
                {x.model}
              </>
            )}
            detail={(x) =>
              `${x.speed.runs.toLocaleString("en-US")} ${x.speed.runs === 1 ? "run" : "runs"}`
            }
            format={(v) => `${Math.round(v)} tok/s`}
          />
        </Block>
      )}

      {threads.length > 0 && (
        <Block title="Busiest threads">
          <Rows
            rows={threads}
            value={(t) => t[m]}
            label={(t) => (
              <>
                <HarnessMark id={t.provider} />
                {t.projectId ? (
                  <button
                    type="button"
                    className="us-link"
                    onClick={() => onOpenChat(t.projectId, t.chat)}
                  >
                    {t.title}
                  </button>
                ) : (
                  t.title
                )}
              </>
            )}
            detail={(t) => t.project}
            format={(v) => measured(v, m)}
            strong={(_, i) => i === 0}
          />
        </Block>
      )}

      {relay > 0 && (
        <p className="us-footnote">
          Relay’s own work came to {measured(relay, m)}
          {m === "fresh" && " tokens"},{" "}
          {((relay / (m === "usd" ? totals.usd : totals.fresh)) * 100).toFixed(
            1,
          )}
          % of it:{" "}
          {Object.entries(totals.relayJobs)
            .filter(([, spent]) => spent[m] > 0)
            .sort((a, b) => b[1][m] - a[1][m])
            .map(
              ([job, spent]) =>
                `${midSentence(relayJobLabels[job as keyof typeof relayJobLabels])} ${measured(spent[m], m)}`,
            )
            .join(", ")}
          .
        </p>
      )}
    </div>
  );
}
