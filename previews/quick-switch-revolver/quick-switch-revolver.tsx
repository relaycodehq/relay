// Revolver styles for the quick switch: presets are rounds in a cylinder.
// Open http://127.0.0.1:5177/previews/quick-switch-revolver.html
// (?view=cylinder|rounds|swing&at=2, &closed to start hidden)
import "../_shared/desktop-stub";
import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type WheelEvent,
} from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, RotateCw, Zap } from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/quick-switch/quick-switch.css";
import "../_shared/quick-switch.css";
import "./quick-switch-revolver.css";
import { initAppearance } from "../../src/lib/appearance";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { agentName } from "../../shared/agents";
import { effortKeysLabel } from "../../src/features/quick-switch/effort-shortcut";
import { quickItems, type QuickItem } from "../../src/features/quick-switch/quick-switch";
import { catalog, samplePresets } from "../_shared/quick-switch-common";

initAppearance();

const sampleItems = quickItems(
  samplePresets.map((p) => ({
    id: p.id,
    provider: p.provider,
    model: p.model,
    reasoningEffort: p.effort,
    fast: !!p.fast,
  })),
  (provider) => catalog[provider].models,
);

interface Props {
  items: QuickItem[];
  index: number;
  dir: number;
  open: boolean;
  onPick: (index: number) => void;
}

function Heading() {
  return (
    <div className="composer-menu-label">
      Quick switch
      <kbd>{effortKeysLabel()}</kbd>
    </div>
  );
}

function Label({ item, dir }: { item: QuickItem; dir: number }) {
  return (
    <span className="quick-label" key={item.id} data-dir={dir < 0 ? "left" : "right"}>
      <ProviderIcon provider={item.provider} />
      <span>{item.name}</span>
      <span className="quick-effort">{item.effort}</span>
      {item.fast && <Zap size={12} className="quick-fast" aria-label="Fast" />}
    </span>
  );
}

/** The scroll wheel turns the cylinder a chamber at a time. */
function useWheelStep(index: number, count: number, onPick: (i: number) => void) {
  const sum = useRef(0);
  return (e: WheelEvent) => {
    sum.current += e.deltaY;
    if (Math.abs(sum.current) < 40) return;
    const next = index + Math.sign(sum.current);
    sum.current = 0;
    if (next >= 0 && next < count) onPick(next);
  };
}

/**
 * A whole extra turn each time the switcher opens, like flicking a revolver's
 * cylinder; `spinning` slows the transition down for it.
 */
function useSpin(open: boolean) {
  const [turns, setTurns] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const was = useRef(open);
  useEffect(() => {
    const opened = open && !was.current;
    was.current = open;
    if (!opened) return;
    setTurns((t) => t + 1);
    setSpinning(true);
    const timer = setTimeout(() => setSpinning(false), 950);
    return () => clearTimeout(timer);
  }, [open]);
  return { turns, spinning };
}

/** Six chambers at least; presets beyond that add more. Unloaded ones stay empty. */
const chambersFor = (count: number) => Math.max(6, count);

/**
 * Chambers around a centre, turned by `--rot`. Each round turns back by the
 * same angle on the same curve, so glyphs stay upright while the cylinder spins.
 */
function Chambers({
  items,
  index,
  onPick,
  depth,
}: {
  items: QuickItem[];
  index: number;
  onPick: (i: number) => void;
  /** Swing-out: nearer rounds grow and draw on top. */
  depth?: boolean;
}) {
  const n = chambersFor(items.length);
  const step = 360 / n;
  return Array.from({ length: n }, (_, i) => {
    const item = items[i];
    const near = Math.cos(((i - index) * step * Math.PI) / 180);
    return (
      <button
        key={item?.id ?? `empty-${i}`}
        type="button"
        className="quick-chamber"
        data-provider={item?.provider}
        data-empty={!item || undefined}
        aria-pressed={i === index}
        aria-label={item ? `${item.name}, ${item.effort}` : "Empty chamber"}
        disabled={!item}
        tabIndex={-1}
        style={
          {
            "--a": `${i * step}deg`,
            ...(depth && {
              "--s": 0.7 + 0.3 * ((near + 1) / 2),
              "--o": 0.35 + 0.65 * ((near + 1) / 2),
              zIndex: Math.round(10 + near * 5),
            }),
          } as CSSProperties
        }
        onClick={() => item && onPick(i)}
      >
        {item && (
          <span className="quick-round">
            <ProviderIcon provider={item.provider} />
          </span>
        )}
      </button>
    );
  });
}

/** 1: the cylinder from behind; the chamber under the barrel is the pick. */
function Cylinder({ items, index, dir, open, onPick }: Props) {
  const { turns, spinning } = useSpin(open);
  const n = chambersFor(items.length);
  const rot = -index * (360 / n) - turns * 360;
  const at = items[index];
  return (
    <div className="composer-select-popup quick-popup quick-cyl-popup" data-provider={at.provider}>
      <Heading />
      <div className="quick-cyl-body">
        <div className="quick-cyl-frame" onWheel={useWheelStep(index, items.length, onPick)}>
          <span className="quick-cyl-sight" key={index} aria-hidden />
          <div
            className="quick-cyl"
            data-spinning={spinning || undefined}
            style={{ "--rot": `${rot}deg` } as CSSProperties}
          >
            {Array.from({ length: n }, (_, i) => (
              <span
                key={i}
                className="quick-flute"
                style={{ "--a": `${(i + 0.5) * (360 / n)}deg` } as CSSProperties}
                aria-hidden
              />
            ))}
            <Chambers items={items} index={index} onPick={onPick} />
            <span className="quick-axle" aria-hidden />
          </div>
        </div>
        <div className="quick-cyl-info" key={at.id} data-dir={dir < 0 ? "down" : "up"}>
          <strong>{at.name}</strong>
          <span className="quick-effort">
            {at.effort}
            {at.fast && <Zap size={12} aria-label="Fast" />}
          </span>
          <small>
            {agentName(at.provider)} · {index + 1} of {items.length}
          </small>
        </div>
      </div>
    </div>
  );
}

/** 2: the drum again, with each preset a cartridge turning through the chamber. */
function Rounds({ items, index, open, onPick }: Props) {
  const { turns, spinning } = useSpin(open);
  return (
    <div
      className="composer-select-popup quick-popup quick-rounds"
      data-provider={items[index].provider}
    >
      <Heading />
      <div className="quick-rounds-view" onWheel={useWheelStep(index, items.length, onPick)}>
        <span className="quick-rounds-chamber" key={index} aria-hidden />
        {items.map((item, i) => {
          const d = i - index;
          return (
            <button
              key={item.id}
              type="button"
              className="quick-cartridge"
              data-provider={item.provider}
              data-spinning={spinning || undefined}
              aria-pressed={d === 0}
              tabIndex={-1}
              style={
                {
                  "--d": d - turns * 18,
                  "--ad": Math.min(Math.abs(d), 4),
                } as CSSProperties
              }
              onClick={() => onPick(i)}
            >
              <span className="quick-cartridge-rim" />
              <span className="quick-cartridge-case">
                <ProviderIcon provider={item.provider} />
                <span className="quick-name">{item.name}</span>
                {item.fast && <Zap size={12} className="quick-fast" aria-label="Fast" />}
                <span className="quick-row-effort">{item.effort}</span>
              </span>
              <span className="quick-cartridge-tip" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 3: the cylinder at an angle, swung out beside the composer; the front round is the pick. */
function Swing({ items, index, dir, open, onPick }: Props) {
  const { turns, spinning } = useSpin(open);
  const n = chambersFor(items.length);
  // Half a turn on, so the pick comes round to the front rather than the back.
  const rot = 180 - index * (360 / n) - turns * 360;
  const at = items[index];
  return (
    <div
      className="composer-select-popup quick-popup quick-swing-popup"
      data-provider={at.provider}
      data-open={open || undefined}
    >
      <Heading />
      <div className="quick-swing-view" onWheel={useWheelStep(index, items.length, onPick)}>
        <div className="quick-swing-rig">
          <div className="quick-swing-plane">
            <span className="quick-swing-side" aria-hidden />
            <span className="quick-swing-face" aria-hidden />
            <div
              className="quick-cyl quick-swing-cyl"
              data-spinning={spinning || undefined}
              style={{ "--rot": `${rot}deg` } as CSSProperties}
            >
              <Chambers items={items} index={index} onPick={onPick} depth />
            </div>
          </div>
        </div>
      </div>
      <div className="quick-swing-label">
        <Label item={at} dir={dir} />
      </div>
    </div>
  );
}

const styles = { cylinder: Cylinder, rounds: Rounds, swing: Swing };
type View = keyof typeof styles;
const views: [View, string][] = [
  ["cylinder", "1 · Cylinder"],
  ["rounds", "2 · Rounds"],
  ["swing", "3 · Swing-out"],
];

function Preview() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<View>((params.get("view") as View) || "cylinder");
  const [index, setIndex] = useState(Number(params.get("at") ?? 2));
  const [dir, setDir] = useState(1);
  const [open, setOpen] = useState(!params.has("closed"));
  const items = sampleItems;
  const at = items[index];

  const pick = useCallback(
    (i: number) => {
      setDir(i < index ? -1 : 1);
      setIndex(i);
    },
    [index],
  );
  const step = useCallback(
    (d: -1 | 1) => pick(Math.max(0, Math.min(items.length - 1, index + d))),
    [pick, index, items.length],
  );
  const reopen = () => {
    setOpen(false);
    setTimeout(() => setOpen(true), 260);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") step(-1);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") step(1);
      else return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const Hud = styles[view];
  return (
    <div className="qs-page rv-root">
      <nav className="qs-switcher" aria-label="Option">
        {views.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
        <span className="qs-sample">Sample data · ← → or scroll to turn</span>
      </nav>
      <div className="qs-stage">
        <div className="qs-hud-slot" data-open={open || undefined}>
          <Hud key={view} items={items} index={index} dir={dir} open={open} onPick={pick} />
        </div>
        <div className="project-composer qs-composer">
          <div className="qs-draft">Ask about the code, plan a change, or build something…</div>
          <div className="composer-tools">
            <button
              type="button"
              className="composer-control composer-model-trigger rv-trigger"
              data-provider={at.provider}
              data-popup-open={open || undefined}
              onClick={() => setOpen((o) => !o)}
            >
              <Label item={at} dir={dir} />
            </button>
            <span className="composer-divider" aria-hidden />
            <span className="composer-control">Build</span>
            <span className="qs-spacer" />
            <span className="qs-send" aria-hidden>↑</span>
          </div>
        </div>
      </div>
      <div className="qs-steppers">
        <button type="button" aria-label="Previous preset" onClick={() => step(-1)}>
          <ChevronLeft size={15} />
        </button>
        <button type="button" aria-label="Next preset" onClick={() => step(1)}>
          <ChevronRight size={15} />
        </button>
        <button type="button" aria-label="Open again" title="Open again" onClick={reopen}>
          <RotateCw size={14} />
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
