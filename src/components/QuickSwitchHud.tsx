import {
  Fragment,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent,
} from "react";
import { Zap } from "lucide-react";
import { agentName, type AgentProvider } from "../../shared/agents";
import { effortKeysLabel } from "../lib/effort-shortcut";
import {
  stepPreset,
  useQuickSwitch,
  type QuickItem,
  type QuickSwitchStyle,
} from "../lib/quick-switch";
import {
  chambersReached,
  foldAngle,
  restingCylinder,
  turnCylinder,
  type Cylinder as CylinderState,
} from "../lib/revolver";
import { playClick, wakeClicks, warmClicks } from "../lib/revolver-sound";
import { ProviderIcon } from "./ComposerModelPicker";
import "./quick-switch.css";

interface Props {
  items: QuickItem[];
  index: number;
  /** The last step's direction, for which way things slide. */
  dir: number;
  /** Showing; the revolver spins as it opens. */
  open: boolean;
  /** `dir` is the way it was stepped, when that isn't the way the index went. */
  onPick: (index: number, dir?: number) => void;
}

function Label({ item, dir }: { item: QuickItem; dir: number }) {
  return (
    <span
      className="quick-label"
      key={item.id}
      data-dir={dir < 0 ? "left" : "right"}
    >
      <ProviderIcon provider={item.provider} />
      <span>{item.name}</span>
      <span className="quick-effort">{item.effort}</span>
      {item.fast && <Zap size={12} className="quick-fast" aria-label="Fast" />}
    </span>
  );
}

function Heading() {
  return (
    <div className="composer-menu-label">
      Quick switch
      <kbd>{effortKeysLabel}</kbd>
    </div>
  );
}

/** Consecutive presets of one agent. */
function groupsOf(items: QuickItem[]) {
  const groups: { provider: AgentProvider; from: number; to: number }[] = [];
  items.forEach((item, i) => {
    const last = groups.at(-1);
    if (last?.provider === item.provider) last.to = i;
    else groups.push({ provider: item.provider, from: i, to: i });
  });
  return groups;
}

/** The scroll wheel steps a preset at a time; `wrap` goes on round from the ends. */
function useWheelStep(
  index: number,
  count: number,
  onPick: (index: number, dir: number) => void,
  wrap = false,
) {
  const sum = useRef(0);
  return (e: WheelEvent) => {
    sum.current += e.deltaY;
    if (Math.abs(sum.current) < 40) return;
    const dir = Math.sign(sum.current);
    sum.current = 0;
    const next = stepPreset(count, index, dir < 0 ? -1 : 1, wrap);
    if (next !== index) onPick(next, dir);
  };
}

/** The presets on a turning drum, like a native picker; the middle row is the pick. */
function Drum({ items, index, onPick }: Props) {
  const onWheel = useWheelStep(index, items.length, onPick);
  return (
    <div
      className="composer-select-popup quick-popup quick-drum"
      data-provider={items[index].provider}
    >
      <Heading />
      <div className="quick-drum-view" onWheel={onWheel}>
        <span className="quick-drum-band" aria-hidden />
        {items.map((item, i) => {
          const d = i - index;
          return (
            <button
              key={item.id}
              type="button"
              className="quick-drum-row"
              data-provider={item.provider}
              aria-pressed={d === 0}
              tabIndex={-1}
              style={
                {
                  "--d": d,
                  "--ad": Math.min(Math.abs(d), 4),
                } as CSSProperties
              }
              onClick={() => onPick(i)}
            >
              <ProviderIcon provider={item.provider} />
              <span className="quick-name">{item.name}</span>
              {item.fast && (
                <Zap size={12} className="quick-fast" aria-label="Fast" />
              )}
              <span className="quick-row-effort">{item.effort}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The model menu's rows, with the selection sliding between them. */
function List({ items, index, onPick }: Props) {
  return (
    <div
      className="composer-select-popup quick-popup quick-list"
      data-provider={items[index].provider}
    >
      <Heading />
      <div className="quick-rows" style={{ "--i": index } as CSSProperties}>
        <span className="quick-row-highlight" aria-hidden />
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className="quick-row"
            aria-pressed={i === index}
            tabIndex={-1}
            onClick={() => onPick(i)}
          >
            <ProviderIcon provider={item.provider} />
            <span className="quick-name">{item.name}</span>
            {item.fast && (
              <Zap size={12} className="quick-fast" aria-label="Fast" />
            )}
            <span className="quick-row-effort">{item.effort}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The usage meter's thin track with the Settings switch's knob. */
function Track({ items, index, dir, onPick }: Props) {
  const n = items.length;
  const place = (i: number) => (n > 1 ? i / (n - 1) : 0.5);
  return (
    <div
      className="composer-select-popup quick-popup quick-track-popup"
      data-provider={items[index].provider}
    >
      <Heading />
      <div className="quick-track-body">
        <Label item={items[index]} dir={dir} />
        <div
          className="quick-track"
          style={{ "--frac": place(index) } as CSSProperties}
        >
          <span className="quick-fill" />
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className="quick-stop"
              data-passed={i < index || undefined}
              aria-label={`${item.name}, ${item.effort}`}
              aria-pressed={i === index}
              tabIndex={-1}
              style={{ "--at": place(i) } as CSSProperties}
              onClick={() => onPick(i)}
            />
          ))}
          <span className="quick-knob" aria-hidden />
        </div>
        <div className="quick-groups">
          {groupsOf(items).map((g) => (
            <span
              key={g.from}
              className="quick-group"
              data-on={(index >= g.from && index <= g.to) || undefined}
              data-edge={
                g.to === 0 ? "start" : g.from === n - 1 ? "end" : undefined
              }
              style={
                { "--mid": (place(g.from) + place(g.to)) / 2 } as CSSProperties
              }
            >
              {agentName(g.provider)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One tile per preset on a shelf, split by agent like the Dock; the pick rises. */
function Dock({ items, index, dir, onPick }: Props) {
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
    // The label stays over the tile but only hangs a little past the shelf.
    const room = shelf.current.clientWidth;
    setPlace({
      x,
      tip: Math.min(Math.max(x - width / 2, -8), room - width + 8),
    });
  }, [index, items]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div
      ref={shelf}
      className="composer-select-popup quick-popup quick-dock"
      data-provider={items[index].provider}
      data-animate={animate || undefined}
      style={
        {
          "--x": `${place?.x ?? 0}px`,
          "--tip": `${place?.tip ?? 0}px`,
        } as CSSProperties
      }
    >
      <div ref={tip} className="quick-dock-tip">
        <Label item={items[index]} dir={dir} />
      </div>
      {groupsOf(items).map((g, gi) => (
        <Fragment key={g.from}>
          {gi > 0 && <span className="quick-dock-sep" aria-hidden />}
          {items.slice(g.from, g.to + 1).map((item, k) => {
            const i = g.from + k;
            return (
              <button
                key={item.id}
                ref={(el) => {
                  tiles.current[i] = el;
                }}
                type="button"
                className="quick-dock-tile"
                data-near={Math.abs(i - index) === 1 || undefined}
                aria-pressed={i === index}
                aria-label={`${item.name}, ${item.effort}`}
                title={`${item.name} · ${item.effort}`}
                tabIndex={-1}
                onClick={() => onPick(i)}
              >
                <ProviderIcon provider={item.provider} />
              </button>
            );
          })}
        </Fragment>
      ))}
      <span className="quick-dock-dot" aria-hidden />
    </div>
  );
}

/**
 * Rolls from one preset to the next like an odometer. Every preset also sits
 * unseen in the same grid cell, so the width fits the longest and never jumps.
 */
function Roll({
  items,
  index,
  dir,
  render,
}: {
  items: QuickItem[];
  index: number;
  dir: number;
  render: (item: QuickItem) => ReactNode;
}) {
  const value = items[index];
  const [shown, setShown] = useState(value);
  const [leaving, setLeaving] = useState<QuickItem>();
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
    <span className="quick-roll" data-dir={dir < 0 ? "down" : "up"}>
      {items.map((item) => (
        <span key={`size-${item.id}`} className="quick-roll-size" aria-hidden>
          {render(item)}
        </span>
      ))}
      {leaving && (
        <span
          key={`out-${leaving.id}`}
          className="quick-roll-item"
          data-state="out"
          aria-hidden
        >
          {render(leaving)}
        </span>
      )}
      <span key={`in-${value.id}`} className="quick-roll-item" data-state="in">
        {render(value)}
      </span>
    </span>
  );
}

/** How long each motion takes in quick-switch.css, and a margin past it. */
const motionMs = { step: 420, spin: 700, overspin: 820 };
const settleMarginMs = 400;
/**
 * Clicks sound this long after their chamber passed, so one that crossed
 * midway through a frame can still sound midway: the spacing follows the
 * turn itself rather than the frame rate.
 */
const clickLagMs = 24;

/**
 * Clicks as each chamber reaches the notch. It follows the cylinder's actual
 * angle frame by frame while it moves, so the clicks match the motion however
 * it goes: a step, a spin, or a new press partway through one.
 */
function useChamberClicks(
  cylinder: RefObject<HTMLElement | null>,
  { rot, motion }: CylinderState,
  chambers: number,
  on: boolean,
) {
  const angle = useRef(rot);
  const last = useRef(Math.round((-rot * chambers) / 360));
  useEffect(() => {
    const el = cylinder.current;
    const step = 360 / chambers;
    const target = Math.round(-rot / step);
    if (!el || target === last.current) return;
    const way = target > last.current ? 1 : -1;
    let before = { position: -angle.current / step, time: performance.now() };
    // Each chamber that passed since the last frame clicks at the moment it passed.
    const click = (position: number, time: number) => {
      const reached = chambersReached(last.current, position, way);
      for (let k = 1; k <= reached.count; k++) {
        const chamber = last.current + k * way;
        const part = (chamber - before.position) / (position - before.position);
        const passed = before.time + (time - before.time) * (part || 1);
        playClick(passed + clickLagMs);
      }
      last.current = reached.last;
      before = { position, time };
    };
    if (!on || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No motion to follow: it simply lands.
      if (on) playClick();
      angle.current = rot;
      last.current = target;
      return;
    }
    wakeClicks();
    const started = performance.now();
    let frame = 0;
    let previous = NaN;
    let still = 0;
    const follow = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const now = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      // A frame only sees the angle within a turn. It moves `way` round, or
      // back a little in the bounce at the stop, so a big jump on a slow
      // frame still reads as the way it's going.
      let moved = -foldAngle(now - angle.current) * way;
      if (moved < -30) moved += 360;
      angle.current -= moved * way;
      still = now === previous ? still + 1 : 0;
      previous = now;
      const time = performance.now();
      const elapsed = time - started;
      const stopped =
        (still >= 2 && elapsed > 120 && Math.abs(foldAngle(now - rot)) < 0.5) ||
        elapsed > motionMs[motion] + settleMarginMs;
      if (stopped) {
        // Settle on the known stop, clicking any chamber a slow frame skipped.
        angle.current = rot;
        click(target, time);
        return;
      }
      click(-angle.current / step, time);
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [rot, chambers, on]);
}

/**
 * A revolver's cylinder from behind, a round per preset; the chamber under
 * the notch is the pick. Six chambers at least, so a short list leaves empty
 * ones; more presets add chambers. It turns on past the last preset to the
 * first with an overspin, and a whole turn as it opens.
 */
function Revolver({ items, index, dir, open, onPick }: Props) {
  const onWheel = useWheelStep(index, items.length, onPick, true);
  const n = Math.max(6, items.length);
  const step = 360 / n;
  const [state, setState] = useState(() => restingCylinder(index, open, n));
  if (state.index !== index || state.open !== open)
    setState(turnCylinder(state, index, open, dir, n));
  const cylinder = useRef<HTMLDivElement>(null);
  const { sound } = useQuickSwitch();
  useChamberClicks(cylinder, state, n, sound);
  useEffect(() => {
    if (!sound) return;
    const idle = requestIdleCallback(warmClicks, { timeout: 3000 });
    return () => cancelIdleCallback(idle);
  }, [sound]);
  const at = items[index];
  return (
    <div
      className="composer-select-popup quick-popup quick-revolver"
      data-provider={at.provider}
    >
      <Heading />
      <div className="quick-revolver-body">
        <div className="quick-revolver-frame" onWheel={onWheel}>
          <span className="quick-revolver-notch" key={index} aria-hidden />
          <div
            ref={cylinder}
            className="quick-cylinder"
            data-motion={state.motion}
            style={{ "--rot": `${state.rot}deg` } as CSSProperties}
          >
            {Array.from({ length: n }, (_, i) => (
              <span
                key={`flute-${i}`}
                className="quick-flute"
                style={{ "--a": `${(i + 0.5) * step}deg` } as CSSProperties}
                aria-hidden
              />
            ))}
            {Array.from({ length: n }, (_, i) => {
              const item = items[i];
              return (
                <button
                  key={item?.id ?? `empty-${i}`}
                  type="button"
                  className="quick-chamber"
                  data-provider={item?.provider}
                  aria-pressed={i === index}
                  aria-label={
                    item ? `${item.name}, ${item.effort}` : "Empty chamber"
                  }
                  disabled={!item}
                  tabIndex={-1}
                  style={{ "--a": `${i * step}deg` } as CSSProperties}
                  onClick={() => item && onPick(i)}
                >
                  {item && (
                    <span className="quick-round">
                      <ProviderIcon provider={item.provider} />
                    </span>
                  )}
                </button>
              );
            })}
            <span className="quick-axle" aria-hidden />
          </div>
        </div>
        <div
          className="quick-revolver-info"
          key={at.id}
          data-dir={dir < 0 ? "down" : "up"}
        >
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

/** A tab that rises out of the composer's top edge, with the pick rolling in. */
function Tab({ items, index, dir, open }: Props) {
  return (
    <div className="quick-tab-clip">
      <div
        className="quick-tab"
        data-provider={items[index].provider}
        data-open={open || undefined}
      >
        <Roll
          items={items}
          index={index}
          dir={dir}
          render={(item) => (
            <>
              <ProviderIcon provider={item.provider} />
              <span>{item.name}</span>
              <span className="quick-effort" data-provider={item.provider}>
                {item.effort}
              </span>
              {item.fast && (
                <Zap size={12} className="quick-fast" aria-label="Fast" />
              )}
            </>
          )}
        />
        <span className="quick-tab-ticks" aria-hidden>
          {items.map((item, i) => (
            <i
              key={item.id}
              data-provider={item.provider}
              data-on={i === index || undefined}
              data-group-start={
                (i > 0 && items[i - 1].provider !== item.provider) || undefined
              }
            />
          ))}
        </span>
      </div>
    </div>
  );
}

const popups = {
  drum: Drum,
  list: List,
  track: Track,
  dock: Dock,
  revolver: Revolver,
};

/**
 * The quick switch over the composer, in the style picked in Settings. Sits in
 * a zero-height anchor on the composer's top edge; popups rise from it and the
 * tab grows out of it.
 */
export function QuickSwitchHud({
  style,
  open,
  items,
  index,
  dir,
  onPick,
  onHover,
}: Props & {
  style: QuickSwitchStyle;
  /** The pointer is over the switcher, so it shouldn't hide yet. */
  onHover?: (over: boolean) => void;
}) {
  if (!items.length) return null;
  const at = Math.min(Math.max(index, 0), items.length - 1);
  const props = { items, index: at, dir, open, onPick };
  const Popup = style === "tab" ? undefined : popups[style];
  return (
    <div
      className="quick-switch-anchor"
      aria-hidden={!open}
      inert={!open}
      onPointerEnter={() => onHover?.(true)}
      onPointerLeave={() => onHover?.(false)}
    >
      {Popup ? (
        <div className="quick-popup-slot" data-open={open || undefined}>
          <Popup {...props} />
        </div>
      ) : (
        <Tab {...props} />
      )}
    </div>
  );
}
