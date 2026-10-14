import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2 } from "lucide-react";
import { reducedMotion } from "../../../lib/slide-row";
import { useReturnFocus } from "../../../lib/focus-return";
import {
  modulePath,
  plateRadius,
  qrGrid,
  still,
  type Grid,
  type QrEffect,
  type QrPlayer,
  type Square,
} from "./stage";
import { blocks } from "./blocks";
import { ferro } from "./ferro";
import { life } from "./life";
import { swarm } from "./swarm";
import "./qr-code.css";

const EFFECTS = [swarm, blocks, ferro, life];
let lastEffect: QrEffect | undefined;

/** One of the effects at random, never the one from last time. */
function pickEffect() {
  const options = EFFECTS.filter((effect) => effect !== lastEffect);
  lastEffect = options[Math.floor(Math.random() * options.length)];
  return lastEffect;
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const grid = useMemo(() => qrGrid(text), [text]);
  const n = grid.length;
  const path = useMemo(() => modulePath(grid), [grid]);
  const [opened, setOpened] = useState<{
    from: Square;
    effect: QrEffect;
  } | null>(null);
  return (
    <>
      <button
        type="button"
        className="phone-qr"
        aria-label={`${label}, enlarge`}
        style={opened ? { visibility: "hidden" } : undefined}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpened({
            from: { x: r.left, y: r.top, size: r.width },
            effect: pickEffect(),
          });
        }}
      >
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${n} ${n}`}
          shapeRendering="crispEdges"
        >
          <rect width={n} height={n} rx={plateRadius(n)} fill="#fff" />
          <path d={path} fill="#000" />
        </svg>
        <span className="phone-qr-expand" aria-hidden="true">
          <Maximize2 size={12} />
        </span>
      </button>
      {opened && (
        <QrEnlarged
          grid={grid}
          from={opened.from}
          label={label}
          effect={opened.effect}
          onClosed={() => setOpened(null)}
        />
      )}
    </>
  );
}

function QrEnlarged({
  grid,
  from,
  label,
  effect,
  onClosed,
}: {
  grid: Grid;
  from: Square;
  label: string;
  effect: QrEffect;
  onClosed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const player = useRef<QrPlayer | null>(null);
  const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
  useReturnFocus();
  const [to] = useState(() => {
    const n = grid.length;
    const unit = Math.max(
      4,
      Math.floor((Math.min(innerWidth, innerHeight) * 0.66) / n),
    );
    const size = unit * n;
    return {
      x: Math.round((innerWidth - size) / 2),
      y: Math.round((innerHeight - size) / 2),
      size,
    };
  });

  useLayoutEffect(() => {
    const root = dialog.current!;
    if (!root.open) root.showModal();
    const run = (reducedMotion() ? still : effect)({
      grid,
      from,
      to,
      layer: layer.current!,
    });
    player.current = run;
    let live = true;
    void run.play(1).then(() => live && setPhase("open"));
    return () => {
      live = false;
      run.dispose();
      player.current = null;
    };
  }, [effect, from, grid, to]);

  const close = () => {
    if (phase === "closing" || !player.current) return;
    setPhase("closing");
    void player.current.play(-1).then(onClosed);
  };

  useLayoutEffect(() => {
    // The code is laid out for the window it opened in.
    addEventListener("resize", onClosed);
    return () => removeEventListener("resize", onClosed);
  }, [onClosed]);

  return createPortal(
    <dialog
      ref={dialog}
      className="qr-enlarged"
      data-phase={phase}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={close}
    >
      <div className="qr-enlarged-backdrop" />
      <div ref={layer} className="qr-enlarged-layer" />
      <p className="qr-enlarged-hint" style={{ top: to.y + to.size + 18 }}>
        Click or press Esc to put it back
      </p>
    </dialog>,
    document.body,
  );
}
