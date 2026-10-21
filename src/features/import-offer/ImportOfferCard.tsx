import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, MessageSquare } from "lucide-react";
import {
  freshChats,
  ghostId,
  placementsOf,
  type ImportOffer,
  type ImportPicks,
} from "../../../shared/import-offer";
import { api } from "../../lib/api";
import { relativeDate } from "../../lib/relative-date";
import { ErrorBox } from "../../ui/ui";
import { forkThreadSettings } from "../agents/composer-settings";
import {
  allPicks,
  plannedProjects,
  setPicks,
  showPlan,
  usePlan,
} from "./import-plan";
import "../deep-review/deep-review.css";
import "./import-offer.css";

function Tick({
  checked,
  mixed = false,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (box.current) box.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={box}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

const count = (picks: ImportPicks) =>
  Object.values(picks).reduce((n, ids) => n + ids.length, 0);

/** The same projects with the same chats, whatever their order. */
const samePicks = (a: ImportPicks, b: ImportPicks) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(
    ([key, ids]) =>
      b[key]?.length === ids.length && ids.every((id) => b[key]!.includes(id)),
  );

/**
 * What an agent offered to import, laid out like deep review's findings:
 * projects and their chats to tick, then Import. The new projects stand in
 * the sidebar meanwhile, where dragging them changes their group and order.
 */
export function ImportOfferCard({
  chatId,
  messageId,
  offer,
  running,
}: {
  chatId: string;
  messageId: string;
  offer: ImportOffer;
  /** The answer is still being written; importing waits for it. */
  running: boolean;
}) {
  const qc = useQueryClient();
  const plan = usePlan(chatId, offer);
  const real = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects(),
  }).data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const done = offer.done;
  useEffect(() => {
    if (done) return;
    showPlan(plan);
    return () => showPlan(undefined, plan.key);
  }, [done, plan.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = plan.order?.map((o) => o.id);
  const projects = order
    ? [...plan.offer.projects].sort(
        (a, b) =>
          rank(order, a.projectId ?? ghostId(a.key)) -
          rank(order, b.projectId ?? ghostId(b.key)),
      )
    : plan.offer.projects;
  const picks = plan.picks;
  const everything = allPicks(offer);
  const chosen = count(picks);
  const total = count(everything);
  const all = samePicks(picks, everything);
  const locked = busy || running || !!done;
  const pick = (key: string, ids: string[] | undefined) => {
    const next = { ...picks };
    if (ids) next[key] = ids;
    else delete next[key];
    setPicks(plan, next);
  };

  async function run(chosenPicks: ImportPicks) {
    if (locked || !real) return;
    setBusy(true);
    setError(undefined);
    try {
      const listed = plannedProjects(
        real.filter((p) => !p.scratch),
        { ...plan, picks: chosenPicks },
      );
      const result = await api.runImportOffer(chatId, messageId, {
        picks: chosenPicks,
        placements: placementsOf(listed),
      });
      // Imported chats carry on with the agent they were made with.
      for (const entry of result.projects)
        for (const chat of entry.chats)
          if (chat.created)
            forkThreadSettings(
              `new:${entry.project.id}`,
              chat.chat.id,
              offer.app,
              undefined,
            );
      showPlan(undefined, plan.key);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["projects"] }),
        qc.invalidateQueries({ queryKey: ["project-groups"] }),
        qc.invalidateQueries({ queryKey: ["project-chats"] }),
      ]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="deep-review-tray import-offer"
      aria-label="Projects to import"
    >
      <ol className="deep-review-tasks">
        {projects.map((p) => {
          const fresh = freshChats(p).map((c) => c.id);
          const on = picks[p.key];
          const imported = done?.imported[p.key];
          const failed = done?.failures.filter((f) => f.key === p.key) ?? [];
          return (
            <li
              key={p.key}
              className="deep-review-task import-offer-project"
              data-off={(done ? !imported : !on) || undefined}
            >
              <label className="deep-review-task-head" title={p.path}>
                {done && imported ? (
                  <CircleCheck
                    size={15}
                    className="deep-review-task-fixed"
                    aria-label="Imported"
                  />
                ) : (
                  <Tick
                    label={`Import ${p.name}`}
                    checked={!!on}
                    mixed={!!on && on.length > 0 && on.length < fresh.length}
                    disabled={locked || (!!p.projectId && !fresh.length)}
                    onChange={(v) => pick(p.key, v ? fresh : undefined)}
                  />
                )}
                <span className="deep-review-task-title">{p.name}</span>
                <span className="import-offer-where">
                  {done
                    ? imported
                      ? ""
                      : failed.length
                        ? "failed"
                        : "skipped"
                    : `${p.projectId ? "already here · " : ""}${p.projectId ? "keeps its place" : p.group || "no group"}`}
                </span>
              </label>
              {failed
                .filter((f) => !f.chatId)
                .map((f, i) => (
                  <p key={i} className="import-offer-failure">
                    {f.message}
                  </p>
                ))}
              {p.chats.length > 0 && (
                <ul className="import-offer-chats">
                  {p.chats.map((chat) => {
                    const have = !!chat.chatId;
                    const ticked =
                      have ||
                      !!(done ? imported : on)?.includes(chat.id);
                    const failure = failed.find((f) => f.chatId === chat.id);
                    return (
                      <li key={chat.id}>
                        <label
                          className="import-offer-chat"
                          data-have={have || undefined}
                          data-off={!ticked || undefined}
                          title={failure?.message}
                        >
                          <Tick
                            label={`Import ${chat.title}`}
                            checked={ticked}
                            disabled={locked || have}
                            onChange={(v) => {
                              const rest = (on ?? []).filter(
                                (id) => id !== chat.id,
                              );
                              pick(
                                p.key,
                                v
                                  ? [...rest, chat.id]
                                  : rest.length || !p.projectId
                                    ? rest
                                    : undefined,
                              );
                            }}
                          />
                          <MessageSquare size={13} />
                          <span className="import-offer-chat-title">
                            {chat.title}
                          </span>
                          <span className="import-offer-chat-meta">
                            {have
                              ? "in Relay"
                              : failure
                                ? "couldn't be read"
                                : `${chat.turns} ${chat.turns === 1 ? "turn" : "turns"} · ${relativeDate(new Date(chat.updated).toISOString())}`}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {!!error && <ErrorBox error={error} />}
      {!done && (
        <footer>
          <span className="import-offer-hint">
            Drag projects in the sidebar to regroup
          </span>
          <span className="spacer" />
          <button
            type="button"
            disabled={locked || !Object.keys(picks).length || all}
            onClick={() => void run(picks)}
          >
            Import selected{chosen && !all ? ` (${chosen})` : ""}
          </button>
          <button
            type="button"
            className="primary"
            disabled={locked || !Object.keys(everything).length}
            onClick={() => void run(everything)}
          >
            {busy ? "Importing…" : `Import all ${total}`}
          </button>
        </footer>
      )}
    </section>
  );
}

const rank = (order: string[], id: string) => {
  const at = order.indexOf(id);
  return at < 0 ? order.length : at;
};
