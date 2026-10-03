import { useState, type CSSProperties } from "react";
import { Laptop, Plus } from "lucide-react";
import { DeviceIcon } from "./DeviceIcon";
import {
  addH,
  mapLayout,
  mapW,
  nodeH,
  nodeW,
  selfW,
} from "./computer-map-geometry";
import { stateWord, summary, type Computer } from "./computer-status";

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
  const rows = [
    ...computers.map((c) => ({ id: c.id, h: nodeH, c })),
    { id: "add", h: addH, c: undefined },
  ];
  const { tops, height, selfY, x1, mid, wire, at } = mapLayout(
    rows.map((r) => r.h),
  );
  return (
    <div className="cm-map" role="group" aria-label="Your computers">
      <div className="cm-canvas" style={{ width: mapW, height }}>
        <svg className="cm-wires" width={mapW} height={height} aria-hidden>
          {rows.map(({ id, c }, i) => (
            <path
              key={id}
              d={wire(mid(i))}
              pathLength={1}
              className={`cm-wire ${c ? (c.status === "online" ? "on" : "off") : "add"} ${picked === id || hover === id ? "lit" : ""}`}
              style={{ "--i": i } as CSSProperties}
            />
          ))}
          {rows.map(({ c }, i) =>
            c?.threads.map((t, j) => {
              const p = at(mid(i), (j + 1) / (c.threads.length + 1));
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
        {rows.map(({ id, h, c }, i) => {
          const props = {
            type: "button" as const,
            style: {
              left: x1,
              top: tops[i],
              width: nodeW,
              height: h,
              "--i": i,
            } as CSSProperties,
            "aria-pressed": picked === id,
            onClick: () => onPick(id),
            onMouseEnter: () => setHover(id),
            onMouseLeave: () => setHover(undefined),
          };
          return c ? (
            <button
              key={id}
              className={`cm-node ${c.status === "online" ? "on" : "off"} ${picked === id ? "picked" : ""}`}
              {...props}
            >
              <span className="cm-tile">
                <DeviceIcon name={c.name} />
              </span>
              <span className="cm-node-text">
                <b>{c.name}</b>
                <small>
                  <i
                    className={`cm-dot ${c.status === "online" ? "on" : ""}`}
                  />
                  {summary(c)}
                </small>
              </span>
            </button>
          ) : (
            <button
              key={id}
              className={`cm-node add ${picked === id ? "picked" : ""}`}
              {...props}
            >
              <Plus size={15} strokeWidth={2} aria-hidden />
              Add a computer
            </button>
          );
        })}
      </div>
    </div>
  );
}
