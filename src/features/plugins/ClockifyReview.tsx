import { useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import {
  formatDuration,
  type ClockifyBlock,
  type ClockifyBlockEdit,
  type ClockifyReview as Review,
} from "../../../shared/clockify";
import { api } from "../../lib/api";
import { clockifyKey, projectColor, useClockifyProjects } from "./plugins";
import { ErrorBox, Modal } from "../../ui/ui";
import { ClockifyDay } from "./ClockifyDay";
import { ClockifyEntry } from "./ClockifyEntry";
import { clock } from "./clockify-format";
import "./clockify.css";

type Edit = Partial<Omit<ClockifyBlockEdit, "id">>;

/**
 * The day before it goes to Clockify: a calendar column of entries beside
 * the one selected. Moving an edge moves time between entries; the day's
 * total stays what the timer measured.
 */
export function ClockifyReview({
  review,
  onClose,
}: {
  review: Review;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  // Drags and selects commit from handlers made before their edit rendered.
  const pending = useRef(edits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [discarding, setDiscarding] = useState(false);
  const [picked, setPicked] = useState<string>();
  const projects = useClockifyProjects();
  const relayProjects = useQuery({
    queryKey: ["clockify-relay-projects"],
    queryFn: () => api.projects(),
  });

  const blocks: ClockifyBlock[] = review.blocks.map((b) => ({
    ...b,
    ...edits[b.id],
  }));
  const shown = blocks.filter((b) => b.end > b.start);
  const selected =
    shown.find((b) => b.id === picked) ??
    shown.find((b) => b.clockifyProjectId && !b.submittedId) ??
    shown[0];
  const index = selected ? shown.indexOf(selected) : -1;
  const unsent = shown.filter((b) => b.clockifyProjectId && !b.submittedId);
  const sent = shown.filter((b) => b.submittedId).length;
  const sum = (list: ClockifyBlock[]) =>
    list.reduce((s, b) => s + b.end - b.start, 0);

  const nameOf = (id: string) =>
    projects.data?.find((p) => p.id === id)?.name ?? "Clockify project";
  const labelOf = (b: ClockifyBlock) =>
    b.clockifyProjectId
      ? nameOf(b.clockifyProjectId)
      : b.reason === "other"
        ? "Untracked projects"
        : b.reason === "idle"
          ? "Quiet time"
          : "Left out";
  const colorOf = (b: ClockifyBlock) =>
    b.clockifyProjectId
      ? projectColor(projects.data, b.clockifyProjectId)
      : "var(--muted)";

  const totals = new Map<string, number>();
  for (const b of shown)
    if (b.clockifyProjectId)
      totals.set(
        b.clockifyProjectId,
        (totals.get(b.clockifyProjectId) ?? 0) + b.end - b.start,
      );
  const leftOut = sum(shown.filter((b) => !b.clockifyProjectId));

  const edit = (id: string, next: Edit) => {
    pending.current = {
      ...pending.current,
      [id]: { ...pending.current[id], ...next },
    };
    setEdits(pending.current);
  };

  /** Saves the fields edited in these entries, and only those. */
  async function commit(ids: string[]) {
    const changed = ids
      .filter((id) => pending.current[id])
      .map((id) => ({ id, ...pending.current[id] }));
    if (!changed.length) return;
    const rest = { ...pending.current };
    for (const id of ids) delete rest[id];
    pending.current = rest;
    try {
      qc.setQueryData(clockifyKey, await api.saveClockifyReview(changed));
    } catch (e) {
      setError(e);
      await qc.invalidateQueries({ queryKey: clockifyKey });
    } finally {
      setEdits(pending.current);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      qc.setQueryData(clockifyKey, await action());
    } catch (e) {
      setError(e);
      await qc.invalidateQueries({ queryKey: clockifyKey });
    } finally {
      setBusy(false);
    }
  }

  const step = (by: 1 | -1) => {
    const next = shown[index + by];
    if (!next) return;
    setPicked(next.id);
    // Focus follows the selection when it was on an entry, so rings agree.
    if (document.activeElement?.classList.contains("clockify-event"))
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`.clockify-event[data-id="${next.id}"]`)
          ?.focus(),
      );
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [role=separator]")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1);
    }
  };

  const day = new Date(review.start).toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <Modal title={day} onClose={onClose} className="clockify-review">
      <div className="clockify-review-summary">
        <p>
          {clock(review.start)} – {clock(review.end)} ·{" "}
          {formatDuration(sum(shown))} tracked
        </p>
        <ul aria-label="Time per project">
          {[...totals].map(([id, ms]) => (
            <li
              key={id}
              style={{ ["--c" as string]: projectColor(projects.data, id) }}
            >
              <i aria-hidden />
              {nameOf(id)}
              <span>{formatDuration(ms)}</span>
            </li>
          ))}
          {leftOut > 0 && (
            <li data-empty>
              <i aria-hidden />
              Left out
              <span>{formatDuration(leftOut)}</span>
            </li>
          )}
        </ul>
      </div>

      <div className="clockify-review-body" onKeyDown={onKeyDown}>
        <div className="clockify-review-day">
          <ClockifyDay
            review={review}
            blocks={blocks}
            selected={selected?.id}
            colorOf={colorOf}
            labelOf={labelOf}
            onSelect={setPicked}
            onEdit={edit}
            onCommit={(ids) => void commit(ids)}
          />
        </div>
        {selected && (
          <ClockifyEntry
            key={selected.id}
            block={selected}
            index={index}
            count={shown.length}
            projects={projects.data}
            color={colorOf(selected)}
            relayName={
              relayProjects.data?.find((p) => p.id === selected.relayProjectId)
                ?.name
            }
            threads={review.threads ?? {}}
            describing={review.describing}
            onStep={step}
            onEdit={(next) => edit(selected.id, next)}
            onCommit={() => void commit([selected.id])}
          />
        )}
      </div>

      {review.describeError && (
        <p className="clockify-review-error">
          Couldn't draft the descriptions: {review.describeError}
        </p>
      )}
      {!!error && <ErrorBox error={error} />}

      <footer className="clockify-review-foot">
        {discarding ? (
          <>
            <p>Drop the entries that aren't in Clockify yet?</p>
            <button
              className="text-button"
              onClick={() => setDiscarding(false)}
            >
              Keep them
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(() => api.discardClockifyReview()).then(onClose)
              }
            >
              Drop
            </button>
          </>
        ) : unsent.length ? (
          <>
            <button
              className="text-button"
              disabled={busy || review.describing}
              onClick={() => void run(() => api.describeClockifyReview())}
            >
              {review.describing ? "Drafting…" : "Redraft descriptions"}
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setDiscarding(true)}
            >
              Discard
            </button>
            <p>
              {unsent.length} {unsent.length === 1 ? "entry" : "entries"} ·{" "}
              {formatDuration(sum(unsent))}
              {sent ? ` · ${sent} already in Clockify` : ""}
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await commit(Object.keys(pending.current));
                  return api.submitClockifyReview();
                })
              }
            >
              {busy ? "Sending…" : "Send to Clockify"}
            </button>
          </>
        ) : (
          <>
            <p className="clockify-review-done">
              <Check size={14} aria-hidden />
              {sent
                ? `All ${sent} ${sent === 1 ? "entry is" : "entries are"} in Clockify`
                : "Nothing to send"}
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(() => api.discardClockifyReview()).then(onClose)
              }
            >
              Done
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}
