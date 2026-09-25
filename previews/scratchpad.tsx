// Scratchpad: chats about anything, outside Projects. Each chat gets its own
// folder, no Git. ⌘⇧N opens one, and the headline's last word arrives under
// scratch-off foil. Sample data, the app's own styles.
// Open http://127.0.0.1:5177/previews/scratchpad.html
import "./desktop-stub";
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  FolderGit2,
  MessageCircle,
  Plus,
  Sparkles,
} from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "./deep-review.css";
import "./scratchpad.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";

initAppearance();
initWindowFocus();

type Effect = "zigzag" | "swipes" | "manual" | "handwritten";
type Point = { x: number; y: number };
type Flake = Point & { vx: number; vy: number; age: number; size: number; tint: string };

const FLAKE_LIFE = 750;

function paintFoil(f: CanvasRenderingContext2D, w: number, h: number, dark: boolean) {
  const g = f.createLinearGradient(0, 0, w, h);
  const stops = dark
    ? ["#3c3d44", "#6b6d77", "#4a4b53", "#7a7c86", "#393a40"]
    : ["#b5b8c1", "#eceef2", "#c4c7ce", "#f4f5f7", "#acafb8"];
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  f.fillStyle = g;
  f.fillRect(0, 0, w, h);

  // Printed lottery text, barely there.
  f.save();
  f.font = "700 6.5px ui-sans-serif, system-ui";
  f.fillStyle = dark ? "rgb(255 255 255 / 9%)" : "rgb(0 0 0 / 9%)";
  for (let y = 7, row = 0; y < h + 6; y += 8, row++)
    for (let x = row % 2 ? -18 : 0; x < w; x += 44) f.fillText("SCRATCH", x, y);
  f.restore();

  for (let i = 0; i < (w * h) / 5; i++) {
    f.fillStyle =
      Math.random() < 0.55 ? "rgb(255 255 255 / 35%)" : "rgb(0 0 0 / 10%)";
    f.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

/** A polyline walked by distance, so easing applies to the whole path. */
function walker(points: Point[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  const total = lengths[lengths.length - 1];
  return (t: number): Point => {
    const at = t * total;
    let i = 1;
    while (i < lengths.length - 1 && lengths[i] < at) i++;
    const k = (at - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
    return {
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * k,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * k,
    };
  };
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2.2);

type Pass = { at: (t: number) => Point; start: number; duration: number; ease: (t: number) => number };

function ScratchWord({
  children,
  effect,
  dark,
  revealNow,
}: {
  children: ReactNode;
  effect: Effect;
  dark: boolean;
  revealNow: boolean;
}) {
  const foilRef = useRef<HTMLCanvasElement>(null);
  const debrisRef = useRef<HTMLCanvasElement>(null);
  const finishRef = useRef(() => {});
  const [gone, setGone] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useLayoutEffect(() => {
    if (gone) return;
    const foil = foilRef.current!;
    const debris = debrisRef.current!;
    const dpr = devicePixelRatio || 1;
    const fr = foil.getBoundingClientRect();
    const dr = debris.getBoundingClientRect();
    const w = fr.width;
    const h = fr.height;
    foil.width = w * dpr;
    foil.height = h * dpr;
    debris.width = dr.width * dpr;
    debris.height = dr.height * dpr;
    const f = foil.getContext("2d", { willReadFrequently: effect === "manual" })!;
    const d = debris.getContext("2d")!;
    f.scale(dpr, dpr);
    d.scale(dpr, dpr);
    paintFoil(f, w, h, dark);
    f.globalCompositeOperation = "destination-out";
    f.fillStyle = "#000";
    const offset = { x: fr.left - dr.left, y: fr.top - dr.top };
    const tints = dark ? ["#6b6d77", "#8a8c96", "#4a4b53"] : ["#c4c7ce", "#9fa3ad", "#e3e5e9"];

    const flakes: Flake[] = [];
    let finished = false;
    let raf = 0;
    let last = performance.now();

    const spawn = (p: Point, dir: number, count: number) => {
      for (let i = 0; i < count; i++)
        flakes.push({
          x: p.x + offset.x + (Math.random() - 0.5) * h * 0.4,
          y: p.y + offset.y + (Math.random() - 0.3) * h * 0.3,
          vx: dir * (0.4 + Math.random() * 1.4) + (Math.random() - 0.5),
          vy: -0.4 - Math.random() * 1.6,
          age: 0,
          size: 1 + Math.random() * 2.2,
          tint: tints[(Math.random() * tints.length) | 0],
        });
    };

    const scrape = (a: Point, b: Point, r: number, flakeRate: number) => {
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
      for (let i = 1; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const y = a.y + ((b.y - a.y) * i) / steps;
        f.beginPath();
        f.arc(x, y, r * (0.8 + Math.random() * 0.2), 0, Math.PI * 2);
        f.fill();
      }
      if (Math.random() < flakeRate) spawn(b, Math.sign(b.x - a.x) || 1, 2);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      setGone(true);
    };
    finishRef.current = finish;

    const passes: Pass[] = [];
    let brush = h * 0.4;
    let flakeRate = 0.8;
    const delay = 120;
    if (effect === "zigzag") {
      const zigs = Math.max(3, Math.ceil(w / (h * 0.75)));
      const pts: Point[] = [];
      for (let i = 0; i <= zigs; i++)
        pts.push({
          x: -h * 0.15 + ((w + h * 0.3) * i) / zigs,
          y: i % 2 ? h * 0.8 : h * 0.2,
        });
      passes.push({ at: walker(pts), start: delay, duration: 380, ease: easeInOut });
    } else if (effect === "swipes") {
      brush = h * 0.34;
      flakeRate = 0.45;
      const lines: [Point, Point][] = [
        [{ x: -h * 0.2, y: h * 0.18 }, { x: w + h * 0.2, y: h * 0.34 }],
        [{ x: w + h * 0.2, y: h * 0.62 }, { x: -h * 0.2, y: h * 0.86 }],
        [{ x: -h * 0.2, y: h * 0.52 }, { x: w + h * 0.2, y: h * 0.44 }],
      ];
      lines.forEach((pts, i) =>
        passes.push({ at: walker(pts), start: delay + i * 210, duration: 170, ease: easeOut }),
      );
    }
    const t0 = performance.now();
    const drawn = passes.map(() => -1);

    const frame = (now: number) => {
      const dt = Math.min(48, now - last) / 16.67;
      last = now;
      let busy = false;

      passes.forEach((pass, i) => {
        const t = (now - t0 - pass.start) / pass.duration;
        if (t < 0) {
          busy = true;
          return;
        }
        const k = pass.ease(Math.min(1, t));
        if (drawn[i] < 1) {
          const from = pass.at(Math.max(0, drawn[i]));
          const to = pass.at(k);
          scrape(from, to, brush, flakeRate);
          drawn[i] = k;
          busy = true;
        }
      });
      if (passes.length && drawn.every((k) => k >= 1)) finish();

      d.clearRect(0, 0, dr.width, dr.height);
      for (let i = flakes.length - 1; i >= 0; i--) {
        const fl = flakes[i];
        fl.age += 16.67 * dt;
        if (fl.age > FLAKE_LIFE) {
          flakes.splice(i, 1);
          continue;
        }
        fl.vy += 0.14 * dt;
        fl.x += fl.vx * dt;
        fl.y += fl.vy * dt;
        d.globalAlpha = 1 - fl.age / FLAKE_LIFE;
        d.fillStyle = fl.tint;
        d.fillRect(fl.x, fl.y, fl.size, fl.size * 0.7);
      }
      d.globalAlpha = 1;

      raf = busy || flakes.length ? requestAnimationFrame(frame) : 0;
    };
    // Loops only while something moves; manual mode kicks it from pointer events.
    const kick = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    if (passes.length) kick();

    let down: Point | null = null;
    let moves = 0;
    const local = (e: PointerEvent): Point => {
      const r = foil.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const cleared = () => {
      const data = f.getImageData(0, 0, foil.width, foil.height).data;
      let clear = 0;
      let seen = 0;
      for (let i = 3; i < data.length; i += 4 * 7, seen++) if (data[i] < 40) clear++;
      return clear / seen;
    };
    const onDown = (e: PointerEvent) => {
      foil.setPointerCapture(e.pointerId);
      down = local(e);
      scrape(down, down, h * 0.3, 1);
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!down || finished) return;
      const p = local(e);
      scrape(down, p, h * 0.3, 0.7);
      down = p;
      kick();
      if (++moves % 6 === 0 && cleared() > 0.55) finish();
    };
    const onUp = () => (down = null);
    if (effect === "manual") {
      foil.addEventListener("pointerdown", onDown);
      foil.addEventListener("pointermove", onMove);
      foil.addEventListener("pointerup", onUp);
      foil.addEventListener("pointercancel", onUp);
    }
    return () => {
      cancelAnimationFrame(raf);
      foil.removeEventListener("pointerdown", onDown);
      foil.removeEventListener("pointermove", onMove);
      foil.removeEventListener("pointerup", onUp);
      foil.removeEventListener("pointercancel", onUp);
    };
    // Replays remount the word; `gone` only ever flips to true.
  }, []);

  useEffect(() => {
    if (revealNow) finishRef.current();
  }, [revealNow]);

  return (
    <span className="scratch-word" data-manual={effect === "manual" || undefined}>
      {children}
      <canvas ref={debrisRef} className="scratch-debris" aria-hidden />
      <canvas
        ref={foilRef}
        className="scratch-foil"
        aria-hidden
        data-gone={gone || undefined}
      />
    </span>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The word written out in pen, then underlined with a quick scribble. */
function HandWord({ children }: { children: ReactNode }) {
  return (
    <span className="hand-word">
      <span className="hand-ink">{children}</span>
      <svg className="hand-underline" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden>
        <path pathLength={1} d="M4 7 C 60 3, 140 9, 196 4 C 150 8, 90 11, 34 12" />
      </svg>
    </span>
  );
}

type Chat = { id: string; title: string; when: string };

const seeded: Chat[] = [
  { id: "a", title: "Is a heat pump worth it in Brno?", when: "2h" },
  { id: "b", title: "Lisbon in October, 4 days", when: "Tue" },
  { id: "c", title: "Sourdough at 78% hydration", when: "Sep 19" },
  { id: "d", title: "Explain CRDTs like I'm tired", when: "Sep 12" },
];

const verbs = {
  work: "What should we work on in",
  figure: "What should we figure out in",
  talk: "What’s on your mind in",
} as const;
type Verb = keyof typeof verbs;

function App() {
  const appearance = useAppearance();
  const dark = appearance.palette.kind === "dark";
  const [effect, setEffect] = useState<Effect>("zigzag");
  const [verb, setVerb] = useState<Verb>("work");
  const [chats, setChats] = useState<Chat[]>(seeded);
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Chat | null>(null);
  const [run, setRun] = useState(0);
  const [draft, setDraft] = useState("");

  const newChat = () => {
    const chat = { id: crypto.randomUUID(), title: "New chat", when: "now" };
    setFresh(chat);
    setSelected(chat.id);
    setDraft("");
    setRun((n) => n + 1);
  };

  useEffect(() => {
    newChat();
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const send = () => {
    if (!fresh || !draft.trim()) return;
    const title = draft.trim().slice(0, 40);
    setChats((all) => [{ ...fresh, title }, ...all]);
    setFresh(null);
    setDraft("");
  };

  const open = chats.find((c) => c.id === selected);
  const showNew = !!fresh && selected === fresh.id;

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <Sparkles size={14} /> Scratchpad
        </strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Reveal</span>
          <Segmented<Effect>
            label="Reveal"
            value={effect}
            onChange={(v) => {
              setEffect(v);
              newChat();
            }}
            options={[
              { value: "zigzag", label: "Zigzag" },
              { value: "swipes", label: "Three swipes" },
              { value: "manual", label: "Scratch it yourself" },
              { value: "handwritten", label: "Handwritten" },
            ]}
          />
        </div>
        <div className="preview-control">
          <span>Headline</span>
          <Segmented<Verb>
            label="Headline"
            value={verb}
            onChange={setVerb}
            options={[
              { value: "work", label: "work on" },
              { value: "figure", label: "figure out" },
              { value: "talk", label: "on your mind" },
            ]}
          />
        </div>
        <button type="button" className="text-button" onClick={newChat}>
          New chat again (⌘⇧N)
        </button>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => {
            setMode(v as "light" | "dark");
            setRun((n) => n + 1);
          }}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>

      <div className="sp-window">
        <nav className="sp-sidebar" aria-label="Sample sidebar">
          <div>
            <div className="sp-section-head">
              Scratchpad
              <span className="spacer" />
              <kbd>⌘⇧N</kbd>
              <button type="button" className="sp-icon-button" aria-label="New scratch chat" onClick={newChat}>
                <Plus size={13} />
              </button>
            </div>
            {fresh && (
              <button
                type="button"
                className="sp-row"
                aria-current={selected === fresh.id}
                onClick={() => setSelected(fresh.id)}
              >
                <MessageCircle size={13} />
                <span>New chat</span>
              </button>
            )}
            {chats.map((c) => (
              <button
                key={c.id}
                type="button"
                className="sp-row"
                aria-current={selected === c.id}
                onClick={() => setSelected(c.id)}
              >
                <MessageCircle size={13} />
                <span>{c.title}</span>
                <span className="sp-when">{c.when}</span>
              </button>
            ))}
          </div>
          <div>
            <div className="sp-section-head">Projects</div>
            {["relay", "relay-releases", "website"].map((name) => (
              <button key={name} type="button" className="sp-row">
                <FolderGit2 size={13} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </nav>

        <main className="sp-main">
          {showNew ? (
            <div className="thread-start">
              <div className="thread-introduction">
                <h1 aria-label={`${verbs[verb]} Scratchpad?`}>
                  {verbs[verb]}{" "}
                  {effect === "handwritten" ? (
                    <HandWord key={run}>Scratchpad</HandWord>
                  ) : (
                    <ScratchWord
                      key={`${run}:${effect}:${appearance.palette.kind}`}
                      effect={effect}
                      dark={dark}
                      revealNow={draft.length > 0}
                    >
                      Scratchpad
                    </ScratchWord>
                  )}
                  ?
                </h1>
                {effect === "manual" && <p>Scratch the foil, or just start typing.</p>}
              </div>
              <div className="sp-composer">
                <textarea
                  autoFocus
                  value={draft}
                  placeholder="Ask anything"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <footer>
                  <span className="spacer" />
                  <button type="button" className="sp-send" aria-label="Send" disabled={!draft.trim()} onClick={send}>
                    <ArrowUp size={15} />
                  </button>
                </footer>
              </div>
            </div>
          ) : (
            <div className="thread-start">
              <div className="thread-introduction">
                <h1>{open?.title}</h1>
                <p>Sample: the conversation would be here.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
