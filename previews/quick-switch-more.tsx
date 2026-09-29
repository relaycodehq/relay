// Options C–E for the quick switch: a picker drum, a dock, and a tab on the composer.
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
} from "react";
import { Zap } from "lucide-react";
import { ProviderIcon } from "../src/components/ComposerModelPicker";
import {
  Current,
  effortName,
  groupsOf,
  keysLabel,
  modelName,
  type HudProps,
  type Preset,
} from "./quick-switch-common";
import "./quick-switch-more.css";

/** C: the presets on a turning drum, like a native picker; the middle row is the pick. */
export function DrumHud({ presets, index, onPick }: HudProps) {
  const at = presets[index];
  const wheel = useRef(0);
  const onWheel = (e: WheelEvent) => {
    wheel.current += e.deltaY;
    if (Math.abs(wheel.current) < 40) return;
    const next = index + Math.sign(wheel.current);
    wheel.current = 0;
    if (next >= 0 && next < presets.length) onPick(next);
  };
  return (
    <div className="composer-select-popup qs-popup qs-drum" data-provider={at.provider}>
      <div className="composer-menu-label">
        Quick switch
        <kbd>{keysLabel}</kbd>
      </div>
      <div className="qs-drum-view" onWheel={onWheel}>
        <span className="qs-drum-band" aria-hidden />
        {presets.map((p, i) => {
          const d = i - index;
          return (
            <button
              key={p.id}
              type="button"
              className="qs-drum-row"
              data-provider={p.provider}
              aria-pressed={d === 0}
              tabIndex={Math.abs(d) > 2 ? -1 : undefined}
              style={{ "--d": d, "--ad": Math.min(Math.abs(d), 4) } as CSSProperties}
              onClick={() => onPick(i)}
            >
              <ProviderIcon provider={p.provider} />
              <span>{modelName(p)}</span>
              {p.fast && <Zap size={12} className="qs-fast" aria-label="Fast" />}
              <span className="qs-drum-effort">{effortName(p)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** D: one tile per preset on a shelf, split by agent like the Dock; the pick rises. */
export function DockHud({ presets, index, dir, onPick }: HudProps) {
  const at = presets[index];
  const shelf = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const [place, setPlace] = useState<{ x: number; tip: number }>();
  // Glides only after the first placement, so opening doesn't slide in from the edge.
  const [animate, setAnimate] = useState(false);
  useLayoutEffect(() => {
    const tile = tiles.current[index];
    if (!tile || !shelf.current || !tip.current) return;
    const x = tile.offsetLeft + tile.offsetWidth / 2;
    const width = tip.current.offsetWidth;
    // The label stays over the tile but may only hang a little past the shelf.
    const room = shelf.current.clientWidth;
    setPlace({ x, tip: Math.min(Math.max(x - width / 2, -8), room - width + 8) });
  }, [index, presets]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={shelf}
      className="composer-select-popup qs-popup qs-dock"
      data-provider={at.provider}
      data-animate={animate || undefined}
      style={
        {
          "--x": `${place?.x ?? 0}px`,
          "--tip": `${place?.tip ?? 0}px`,
        } as CSSProperties
      }
    >
      <div ref={tip} className="qs-dock-tip">
        <Current preset={at} dir={dir} />
      </div>
      {groupsOf(presets).map((g, gi) => (
        <Fragment key={g.from}>
          {gi > 0 && <span className="qs-dock-sep" aria-hidden />}
          {presets.slice(g.from, g.to + 1).map((p, k) => {
            const i = g.from + k;
            return (
              <button
                key={p.id}
                ref={(el) => {
                  tiles.current[i] = el;
                }}
                type="button"
                className="qs-dock-tile"
                data-near={Math.abs(i - index) === 1 || undefined}
                aria-pressed={i === index}
                aria-label={`${modelName(p)}, ${effortName(p)}`}
                title={`${modelName(p)} · ${effortName(p)}`}
                onClick={() => onPick(i)}
              >
                <ProviderIcon provider={p.provider} />
              </button>
            );
          })}
        </Fragment>
      ))}
      <span className="qs-dock-dot" aria-hidden />
    </div>
  );
}

/**
 * Rolls from one preset to the next like an odometer. Every preset also sits
 * unseen in the same grid cell, so the width fits the longest and never jumps.
 */
function Roll({
  value,
  dir,
  all,
  render,
}: {
  value: Preset;
  dir: number;
  all: Preset[];
  render: (p: Preset) => ReactNode;
}) {
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<Preset>();
  if (shown.id !== value.id) {
    setLeaving(shown);
    setShown(value);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(undefined), 320);
    return () => clearTimeout(timer);
  }, [leaving]);
  return (
    <span className="qs-roll" data-dir={dir < 0 ? "down" : "up"}>
      {all.map((p) => (
        <span key={`size-${p.id}`} className="qs-roll-size" aria-hidden>
          {render(p)}
        </span>
      ))}
      {leaving && (
        <span key={`out-${leaving.id}`} className="qs-roll-item" data-state="out" aria-hidden>
          {render(leaving)}
        </span>
      )}
      <span key={`in-${shown.id}`} className="qs-roll-item" data-state="in">
        {render(shown)}
      </span>
    </span>
  );
}

/** E: a tab that rises out of the composer's top edge, with the pick rolling in. */
export function TabHud({ presets, index, dir, open }: HudProps & { open: boolean }) {
  const at = presets[index];
  return (
    <div className="qs-tab-clip">
      <div className="qs-tab" data-provider={at.provider} data-open={open || undefined} aria-hidden={!open}>
        <Roll
          value={at}
          dir={dir}
          all={presets}
          render={(p) => (
            <>
              <ProviderIcon provider={p.provider} />
              <span>{modelName(p)}</span>
              <span className="qs-tab-effort" data-provider={p.provider}>
                {effortName(p)}
              </span>
              {p.fast && <Zap size={12} className="qs-fast" aria-label="Fast" />}
            </>
          )}
        />
        <span className="qs-tab-ticks" aria-hidden>
          {presets.map((p, i) => (
            <i
              key={p.id}
              data-provider={p.provider}
              data-on={i === index || undefined}
              data-group-start={(i > 0 && presets[i - 1].provider !== p.provider) || undefined}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
