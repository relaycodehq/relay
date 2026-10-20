import { useState, type CSSProperties } from "react";
import { ChevronDown, Laptop, Plus } from "lucide-react";
import { DeviceIcon } from "./DeviceIcon";
import {
  addH,
  mapLayout,
  mapW,
  nodeH,
  nodeW,
  rowH,
  selfW,
} from "./computer-map-geometry";
import {
  reachable,
  slimLine,
  stateWord,
  summary,
  type Computer,
} from "./computer-status";

/** Up to this many computers get a card each; more get a slim row each. */
const roomy = 5;

type Row =
  | { kind: "computer"; id: string; c: Computer }
  | { kind: "offline"; id: string; names: string[] }
  | { kind: "add"; id: string };

/**
 * This computer, a wire out to each paired one with a dot per thread over
 * there, and the box that adds another. With many computers each is a slim
 * row, busy ones first, and the offline ones fold into one row.
 */
export function MapDiagram({
  self,
  computers,
  picked,
  onPick,
}: {
  self: string;
  computers: Computer[];
  picked: string;
  onPick: (id: string) => void;
}) {
  const [hover, setHover] = useState<string>();
  const [showOffline, setShowOffline] = useState(false);
  const dense = computers.length > roomy;
  const rows = dense
    ? denseRows(
        computers,
        showOffline || computers.some((c) => c.id === picked && !isOn(c)),
      )
    : [
        ...computers.map((c) => ({ kind: "computer" as const, id: c.id, c })),
        { kind: "add" as const, id: "add" },
      ];
  const height = (r: Row) => (dense ? rowH : r.kind === "add" ? addH : nodeH);
  const {
    tops,
    height: mapH,
    selfY,
    x1,
    mid,
    wire,
    at,
  } = mapLayout(rows.map(height));
  // A dense map draws in quicker: its rows are many.
  const step = dense ? 0.4 : 1;
  const hovers = (id: string) => ({
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(undefined),
  });
  return (
    <div
      className={`cm-map ${dense ? "dense" : ""}`}
      role="group"
      aria-label="Your computers"
    >
      <div className="cm-canvas" style={{ width: mapW, height: mapH }}>
        <svg className="cm-wires" width={mapW} height={mapH} aria-hidden>
          {rows.map((r, i) => (
            <path
              key={r.id}
              d={wire(mid(i))}
              pathLength={1}
              className={`cm-wire ${wireKind(r)} ${picked === r.id || hover === r.id ? "lit" : ""}`}
              style={{ "--i": i * step } as CSSProperties}
            />
          ))}
          {/* Packed close, the wires leave no room for a dot per thread; the rows count them. */}
          {!dense &&
            rows.map((r, i) =>
              r.kind !== "computer"
                ? null
                : r.c.threads.map((t, j) => {
                    const p = at(mid(i), (j + 1) / (r.c.threads.length + 1));
                    return (
                      <circle
                        key={t.chatId}
                        className={`cm-thread-dot ${t.state}`}
                        cx={p.x}
                        cy={p.y}
                        r={4.5}
                        style={{ "--i": i } as CSSProperties}
                      >
                        <title>
                          {t.title} · {stateWord[t.state]}
                        </title>
                      </circle>
                    );
                  }),
            )}
        </svg>
        <div
          className="cm-node self"
          style={{
            left: 0,
            top: selfY - nodeH / 2,
            width: selfW,
            height: nodeH,
          }}
        >
          <span className="cm-tile">
            <Laptop size={20} strokeWidth={1.7} aria-hidden />
          </span>
          <span className="cm-node-text">
            <b>{self}</b>
            <small>This computer</small>
          </span>
        </div>
        {rows.map((r, i) => {
          const style = {
            left: x1,
            top: tops[i],
            width: nodeW,
            height: height(r),
            "--i": i * step,
          } as CSSProperties;
          if (r.kind === "add")
            return (
              <button
                key={r.id}
                type="button"
                className={`cm-node add ${picked === "add" ? "picked" : ""}`}
                style={style}
                aria-pressed={picked === "add"}
                onClick={() => onPick("add")}
                {...hovers(r.id)}
              >
                <Plus size={dense ? 13 : 15} strokeWidth={2} aria-hidden />
                Add a computer
              </button>
            );
          if (r.kind === "offline")
            return (
              <button
                key={r.id}
                type="button"
                className="cm-node off cm-slim"
                style={style}
                title={r.names.join(", ")}
                onClick={() => setShowOffline(true)}
                {...hovers(r.id)}
              >
                <i className="cm-dot" />
                <b>{r.names.length} offline</b>
                <small>{r.names.join(", ")}</small>
                <ChevronDown size={13} aria-hidden />
              </button>
            );
          const { c } = r;
          const on = isOn(c);
          // Asleep: usable, but not connected yet.
          const dot = c.status === "online" ? "on" : "";
          const props = {
            type: "button" as const,
            style,
            "aria-pressed": picked === c.id,
            onClick: () => onPick(c.id),
            ...hovers(c.id),
          };
          return dense ? (
            <button
              key={c.id}
              className={`cm-node cm-slim ${on ? "on" : "off"} ${picked === c.id ? "picked" : ""}`}
              title={summary(c)}
              {...props}
            >
              <DeviceIcon name={c.name} size={14} />
              <b>{c.name}</b>
              <small>{slimLine(c)}</small>
              <i className={`cm-dot ${dot}`} />
            </button>
          ) : (
            <button
              key={c.id}
              className={`cm-node ${on ? "on" : "off"} ${picked === c.id ? "picked" : ""}`}
              {...props}
            >
              <span className="cm-tile">
                <DeviceIcon name={c.name} />
              </span>
              <span className="cm-node-text">
                <b>{c.name}</b>
                <small>
                  <i className={`cm-dot ${dot}`} />
                  {summary(c)}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const isOn = reachable;

const wireKind = (r: Row) =>
  r.kind === "add" ? "add" : r.kind === "offline" || !isOn(r.c) ? "off" : "on";

/** Busy ones first; two or more offline fold into one row until opened. */
export function denseRows(computers: Computer[], showOffline: boolean): Row[] {
  const online = computers
    .filter(isOn)
    .sort((a, b) => b.threads.length - a.threads.length);
  const offline = computers.filter((c) => !isOn(c));
  return [
    ...online.map((c) => ({ kind: "computer" as const, id: c.id, c })),
    ...(showOffline || offline.length < 2
      ? offline.map((c) => ({ kind: "computer" as const, id: c.id, c }))
      : [
          {
            kind: "offline" as const,
            id: "offline",
            names: offline.map((c) => c.name),
          },
        ]),
    { kind: "add", id: "add" },
  ];
}
