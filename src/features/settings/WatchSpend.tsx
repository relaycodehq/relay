import { useQuery } from "@tanstack/react-query";
import type { WatchSpendSummary } from "../../../shared/watch";
import { api } from "../../lib/api";

const usd = (dollars: number) =>
  dollars < 0.01
    ? "under 1¢"
    : dollars < 1
      ? `${Math.round(dollars * 100)}¢`
      : `$${dollars.toFixed(2)}`;

const share = (part: number, whole: number) => {
  if (!(whole > 0)) return undefined;
  const pct = (part / whole) * 100;
  return pct < 1 ? "under 1%" : `${Math.round(pct)}%`;
};

const kilo = (tokens: number) =>
  tokens < 1000
    ? `${tokens}`
    : tokens < 1_000_000
      ? `${Math.round(tokens / 1000)}k`
      : `${(tokens / 1_000_000).toFixed(1)}M`;

/**
 * What the checks spent this past week, measured from Claude Code's own
 * totals, or the rough figure until there's anything to measure.
 */
export function WatchSpendLine() {
  const { data } = useQuery({
    queryKey: ["watch-spend"],
    queryFn: () => api.watchSpend(),
  });
  if (!data?.checks)
    return (
      <p className="watch-cost">
        One look back after each answer that did some work · about 7¢ a check on
        a long Opus 5.5 thread
      </p>
    );
  const part = share(data.usd, data.threadUsd);
  return (
    <>
      <p
        className="watch-cost"
        title="Dollars and the share are at API list prices. On a subscription the checks come out of your plan's usage instead; the share is only an estimate of how much of it."
      >
        Last {data.days} days · {data.checks}{" "}
        {data.checks === 1 ? "check" : "checks"} · {usd(data.usd)} at API prices
        {part && ` · ${part} of what those threads used`}
      </p>
      {import.meta.env.DEV && <WatchSpendDetail summary={data} />}
    </>
  );
}

/** The breakdown, in development builds only. */
function WatchSpendDetail({ summary }: { summary: WatchSpendSummary }) {
  const split = summary.threads.reduce((n, t) => n + t.split, 0);
  const subagent = summary.threads.reduce((n, t) => n + t.subagentChecks, 0);
  return (
    <details className="watch-spend-detail">
      <summary>Details · dev build</summary>
      <p>
        {summary.checks - split} measured exactly, {split} split out of a busy
        thread and priced at list rates · {subagent} about subagents ·{" "}
        {summary.notes} {summary.notes === 1 ? "note" : "notes"} shown · avg{" "}
        {usd(summary.usd / summary.checks)} a check
      </p>
      <table>
        <thead>
          <tr>
            <th>Thread</th>
            <th>Checks</th>
            <th>Exact / split</th>
            <th>Notes</th>
            <th title="Cache read · written · input · output">Tokens</th>
            <th>Cost</th>
            <th>Of thread</th>
          </tr>
        </thead>
        <tbody>
          {summary.threads.map((t) => (
            <tr key={t.chatId}>
              <td className="watch-spend-title">{t.title}</td>
              <td>
                {t.checks}
                {t.subagentChecks ? ` (${t.subagentChecks} sub)` : ""}
              </td>
              <td>
                {t.checks - t.split} / {t.split}
              </td>
              <td>{t.notes}</td>
              <td>
                {kilo(t.tokens.cacheRead)} · {kilo(t.tokens.cacheWrite)} ·{" "}
                {kilo(t.tokens.input)} · {kilo(t.tokens.output)}
              </td>
              <td>{usd(t.usd)}</td>
              <td>
                {share(t.usd, t.threadUsd) ?? "—"}
                {t.threadUsd > 0 && (
                  <span className="muted"> of {usd(t.threadUsd)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
