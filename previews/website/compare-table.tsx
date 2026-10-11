// Relay beside one other app, or all of them: tabs to switch, a table that can
// hide the rows where both say the same, and who should pick which. The home
// page and the compare page both show it; the words live in compare-data.ts.
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, CircleHelp, Contrast, Minus } from "lucide-react";
import "./compare.css";
import { ISSUES } from "./content";
import {
  CHECKED,
  groups,
  relay,
  rivals,
  type Cell,
  type Mark,
  type Row,
} from "./compare-data";

const ALL = "all";

const marks: Record<Mark, { icon: typeof Check; label: string }> = {
  yes: { icon: Check, label: "Yes" },
  part: { icon: Contrast, label: "Partly" },
  no: { icon: Minus, label: "No" },
  unknown: { icon: CircleHelp, label: "Not documented" },
};

/** The app named by a #vs-<id> or #<id> link, or "all". */
function fromHash(): string | null {
  const id = location.hash.match(/^#(?:vs-)?(.+)$/)?.[1];
  return id && (id === ALL || rivals.some((r) => r.id === id)) ? id : null;
}

const same = (row: Row, id: string) =>
  row.cells[relay.id].mark === row.cells[id].mark;

function MarkIcon({ mark }: { mark: Mark }) {
  const { icon: Icon, label } = marks[mark];
  return (
    <>
      <Icon size={14} aria-hidden />
      <span className="cmp-sr">{label}. </span>
    </>
  );
}

function CellView({ cell }: { cell: Cell }) {
  // "Not documented" is what the unknown mark already says.
  const text =
    cell.mark === "unknown" && cell.text === marks.unknown.label
      ? undefined
      : cell.text;
  return (
    <>
      <MarkIcon mark={cell.mark} />
      {text ? <span>{text}</span> : null}
    </>
  );
}

function Switcher({
  vs,
  onPick,
}: {
  vs: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="cmp-switch">
      <span className="cmp-switch-lead" id="cmp-switch-lead">
        Relay vs
      </span>
      <div
        className="cmp-switch-tabs"
        role="group"
        aria-labelledby="cmp-switch-lead"
      >
        {rivals.map((rival) => (
          <button
            key={rival.id}
            type="button"
            aria-pressed={vs === rival.id}
            onClick={() => onPick(rival.id)}
          >
            {rival.name}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={vs === ALL}
          onClick={() => onPick(ALL)}
        >
          All apps
        </button>
      </div>
    </div>
  );
}

function Table({
  vs,
  onPick,
  diffOnly,
  onDiffOnly,
}: {
  vs: string;
  onPick: (id: string) => void;
  diffOnly: boolean;
  onDiffOnly: (on: boolean) => void;
}) {
  const pair = vs !== ALL;
  const columns = pair
    ? [relay, rivals.find((r) => r.id === vs)!]
    : [relay, ...rivals];
  const shown = (row: Row) => !(pair && diffOnly && same(row, vs));
  return (
    <div
      className="cmp-scroll"
      tabIndex={pair ? undefined : 0}
      aria-label={pair ? undefined : "Comparison table, scrolls sideways"}
    >
      <table className="cmp" data-pair={pair || undefined}>
        <thead>
          <tr>
            <th scope="col">
              <span className="cmp-sr">Capability</span>
              {/* The empty corner sticks with the header, so the switch stays
                  in reach halfway down the table. */}
              {pair ? (
                <label className="cmp-diff">
                  <input
                    type="checkbox"
                    checked={diffOnly}
                    onChange={(event) => onDiffOnly(event.target.checked)}
                  />
                  Only differences
                </label>
              ) : null}
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                data-relay={column.id === relay.id || undefined}
              >
                {column.id === relay.id || pair ? (
                  column.name
                ) : (
                  <button
                    type="button"
                    title={`Relay vs ${column.name}`}
                    onClick={() => onPick(column.id)}
                  >
                    {column.name}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => {
          const rows = group.rows.filter(shown);
          if (rows.length === 0) return null;
          return (
            <tbody key={group.title}>
              <tr className="cmp-group">
                <th scope="colgroup" colSpan={columns.length + 1}>
                  <span>{group.title}</span>
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">
                    {row.label}
                    {row.hint ? <small>{row.hint}</small> : null}
                  </th>
                  {columns.map((column) => {
                    const cell = row.cells[column.id];
                    return (
                      <td
                        // A new app's cells mount fresh, so they fade in.
                        key={column.id}
                        data-mark={cell.mark}
                        data-relay={column.id === relay.id || undefined}
                      >
                        <CellView cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export function CompareTable({
  linked = false,
  differencesFirst = false,
}: {
  /** Follows and writes #vs-<id> in the address, for links to one matchup. */
  linked?: boolean;
  /** Opens with the rows where both say the same hidden. */
  differencesFirst?: boolean;
}) {
  const [vs, setVs] = useState(() => (linked && fromHash()) || rivals[0].id);
  const [diffOnly, setDiffOnly] = useState(differencesFirst);
  const rival = rivals.find((r) => r.id === vs);
  const hidden = rival
    ? groups.flatMap((g) => g.rows).filter((row) => same(row, vs)).length
    : 0;
  const pick = (id: string) => {
    setVs(id);
    if (linked) history.replaceState(null, "", `#vs-${id}`);
  };
  // The page renders after load, too late for the browser to follow #vs-conductor.
  useEffect(() => {
    if (linked && fromHash())
      document.querySelector(".cmp-table")?.scrollIntoView({ block: "start" });
  }, [linked]);
  return (
    <div className="cmp-table" data-pair={rival ? true : undefined}>
      <Switcher vs={vs} onPick={pick} />
      <div className="cmp-sub">
        {rival ? (
          <p className="cmp-about" key={rival.id}>
            <a href={rival.href}>
              {rival.name}
              <ArrowUpRight size={13} />
            </a>{" "}
            {rival.is}
          </p>
        ) : (
          <p className="cmp-about">
            Every app at once. Pick a name to see it beside Relay.
          </p>
        )}
        <div className="cmp-legend" aria-hidden>
          <span data-mark="yes">
            <Check size={13} /> Yes
          </span>
          <span data-mark="part">
            <Contrast size={13} /> Partly
          </span>
          <span data-mark="no">
            <Minus size={13} /> No
          </span>
          <span data-mark="unknown">
            <CircleHelp size={13} /> Not documented
          </span>
        </div>
      </div>
      <Table
        vs={vs}
        onPick={pick}
        diffOnly={diffOnly}
        onDiffOnly={setDiffOnly}
      />
      {rival && diffOnly && hidden > 0 ? (
        <p className="cmp-hidden">
          {hidden} {hidden === 1 ? "row says" : "rows say"} the same for both.{" "}
          <button type="button" onClick={() => setDiffOnly(false)}>
            Show {hidden === 1 ? "it" : "them"}
          </button>
        </p>
      ) : null}
      {rival ? (
        <dl className="cmp-verdict" key={rival.id}>
          <div>
            <dt>Pick {rival.name} if</dt>
            <dd>{rival.pickThem}</dd>
          </div>
          <div>
            <dt>Pick Relay if</dt>
            <dd>{rival.pickRelay}</dd>
          </div>
        </dl>
      ) : null}
      <p className="cmp-note">
        Read from each app's public docs, pricing and changelogs on {CHECKED}.
        Nobody ran them all side by side, and these apps change weekly.
        Something wrong or out of date? <a href={ISSUES}>Tell us</a>.
      </p>
    </div>
  );
}
