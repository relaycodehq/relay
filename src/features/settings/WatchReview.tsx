import { Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WatchReview, WatchReviewNote } from "../../../shared/watch";
import { api } from "../../lib/api";
import { ErrorBox } from "../../ui/ui";

const did: Record<WatchReviewNote["action"], string> = {
  told: "Told the agent",
  known: "I know this",
  dismissed: "Dismissed",
  closed: "Closed",
  open: "Left open",
};

const after: Record<NonNullable<WatchReviewNote["verdict"]>["later"], string> =
  {
    agent: "Agent got there",
    user: "You raised it",
    note: "Used the note",
    never: "Never came up",
    unknown: "Nothing after it",
  };

const count = <T,>(list: T[], pick: (item: T) => boolean) =>
  list.filter(pick).length;

/**
 * What became of this week's notes, in development builds only: what you did
 * with each, and a helper model's grade from how the thread went on.
 */
export function WatchReviewDetail() {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ["watch-review"],
    queryFn: () => api.watchReview(),
  });
  const judge = useMutation({
    mutationFn: () => api.judgeWatchNotes(),
    onSuccess: (review: WatchReview) =>
      client.setQueryData(["watch-review"], review),
  });
  if (!data?.notes.length) return null;
  const { notes } = data;
  const judged = notes.filter((n) => n.verdict);
  const ready = count(notes, (n) => n.ready);
  return (
    <details className="watch-spend-detail">
      <summary>Notes · dev build</summary>
      <p>
        {notes.length} shown in {data.days} days ·{" "}
        {count(notes, (n) => n.action === "told")} told the agent ·{" "}
        {count(notes, (n) => n.action === "known")} known ·{" "}
        {count(notes, (n) => n.action === "dismissed")} dismissed ·{" "}
        {count(notes, (n) => n.action === "closed")} closed before this was kept
        · {count(notes, (n) => n.action === "open")} left open ·{" "}
        {count(notes, (n) => n.read)} read in full
      </p>
      {!!judged.length && (
        <p>
          {judged.length} judged ·{" "}
          {count(judged, (n) => n.verdict!.worth === "yes")} worth it ·{" "}
          {count(judged, (n) => n.verdict!.worth === "marginal")} marginal ·{" "}
          {count(judged, (n) => n.verdict!.worth === "no")} not ·{" "}
          {count(judged, (n) => n.verdict!.later === "agent")} the agent got to
          by itself · {count(judged, (n) => n.verdict!.later === "never")}{" "}
          nobody came back to
        </p>
      )}
      <p>
        <button
          type="button"
          className="text-button"
          disabled={!ready || judge.isPending}
          title="One helper request per thread, on the agent set for questions"
          onClick={() => judge.mutate()}
        >
          {judge.isPending
            ? "Judging…"
            : ready
              ? `Judge ${ready} ${ready === 1 ? "note" : "notes"}`
              : "Nothing new to judge"}
        </button>
      </p>
      {judge.error && <ErrorBox error={judge.error} />}
      <table>
        <thead>
          <tr>
            <th>Thread</th>
            <th>Note</th>
            <th>You</th>
            <th>Worth</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {notes.map((n) => (
            <Fragment key={n.id}>
              <tr
                className={n.verdict?.why ? "watch-review-judged" : undefined}
              >
                <td className="watch-spend-title" title={n.thread}>
                  {n.thread}
                </td>
                <td className="watch-review-note" title={n.line}>
                  {n.title}
                </td>
                <td>
                  {did[n.action]}
                  {n.read ? " · read" : ""}
                </td>
                <td>{n.verdict?.worth ?? "—"}</td>
                <td>{n.verdict ? after[n.verdict.later] : "—"}</td>
              </tr>
              {n.verdict?.why && (
                <tr className="watch-review-why">
                  <td />
                  <td colSpan={4}>{n.verdict.why}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </details>
  );
}
