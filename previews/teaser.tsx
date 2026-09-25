// A teaser for Relay, filmed on the app's own components with sample data.
// Every frame is a function of the teaser clock, so scripts/record-teaser.mjs
// can render it frame by frame. Open http://127.0.0.1:5177/previews/teaser.html
// (?t=12.5 freezes on a moment, ?from=20 starts playing there).
import "./desktop-stub";
import { restoreSavedAppearance } from "./teaser-setup";
import { StrictMode, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/sidebar.css";
import "../src/components/workspace-panes.css";
import "../src/components/working-tree.css";
import "../src/components/terminal-drawer.css";
import "../src/components/agent-trace.css";
import "../src/components/changed-files.css";
import "../src/components/composer-model-picker.css";
import "../src/components/code-references.css";
import "../src/components/deep-review.css";
import "../src/components/relay-mark.css";
import "./deep-review.css";
import "./teaser.css";
import { RelayMark } from "../src/components/RelayMark";
import { initAppearance } from "../src/lib/appearance";
import {
  resolveChoice,
  themeById,
  tokens,
  type ThemeKind,
} from "../src/lib/themes";
import { AppWindow, type WindowState } from "./teaser-window";
import { buildTurn, prompt } from "./teaser-data";
import {
  DURATION,
  clamp,
  ease,
  keyframes,
  mixN,
  play,
  presence,
  seek,
  span,
  typed,
  useTime,
} from "./teaser-time";

initAppearance();
restoreSavedAppearance();

/** Scene boundaries, ms. */
const T = {
  windowIn: 3600,
  typeFrom: 6400,
  modelCodex: 9700,
  modelClaude: 10500,
  send: 11000,
  turnFrom: 11300,
  splitWaits: 14900,
  webDone: 15900,
  cmdFrom: 16600,
  cmdTo: 18100,
  changesFrom: 20200,
  terminalFrom: 25600,
  terminalTo: 30400,
  reviewFrom: 31000,
  reportFrom: 37400,
  themesFrom: 41800,
  themeEvery: 780,
  outroFrom: 48600,
};

const turnDone = T.turnFrom + buildTurn.answerAt + buildTurn.writeFor;

// Light and dark alternate so every switch reads, even at a glance.
const themeReel: { id: string; kind: ThemeKind }[] = [
  { id: "relay", kind: "dark" },
  { id: "catppuccin-latte", kind: "light" },
  { id: "dracula", kind: "dark" },
  { id: "solarized-light", kind: "light" },
  { id: "gruvbox", kind: "dark" },
  { id: "relay", kind: "light" },
  { id: "nord", kind: "dark" },
  { id: "rose-pine", kind: "dark" },
];

function windowState(t: number): WindowState {
  const view =
    t < T.send + 180
      ? "home"
      : t < T.reviewFrom || t >= T.themesFrom
        ? "thread"
        : "review";
  const turn =
    view === "thread"
      ? t >= T.themesFrom
        ? 60_000
        : Math.max(0, t - T.turnFrom)
      : null;
  const changes =
    t >= T.themesFrom
      ? 0
      : ease.inOut(span(t, T.changesFrom, T.changesFrom + 900)) *
        (1 - ease.inOut(span(t, T.terminalTo, T.terminalTo + 500)));
  const terminal =
    ease.out(span(t, T.terminalFrom, T.terminalFrom + 550)) *
    (1 - ease.inOut(span(t, T.terminalTo - 300, T.terminalTo + 200)));
  return {
    t,
    view,
    draft: view === "home" ? typed(prompt, t, T.typeFrom, 31) : "",
    caret:
      view === "home" && t > T.windowIn + 1200 && Math.floor(t / 530) % 2 === 0,
    press: presence(t, T.send - 60, T.send + 180, 60, 120),
    model:
      t >= T.modelCodex && t < T.modelClaude
        ? { provider: "codex", name: "GPT-5.6-Sol" }
        : { provider: "claude", name: "Opus 5.5" },
    turn,
    changes,
    terminal,
    terminalRun: t - T.terminalFrom - 500,
    cmdHeld: t >= T.cmdFrom && t < T.cmdTo,
    splitWaiting: t >= T.splitWaits,
    webDone: t >= T.webDone,
    review: Math.max(0, t - T.reviewFrom - 400),
    reportShown: span(t, T.reportFrom, T.reportFrom + 1200),
    scroll:
      view === "thread" && t < T.themesFrom
        ? ease.inOut(span(t, T.turnFrom + 5200, T.turnFrom + 6400)) * 90 +
          ease.inOut(span(t, turnDone - 200, turnDone + 900)) * 120
        : view === "review"
          ? ease.inOut(span(t, T.reportFrom + 200, T.reportFrom + 1400)) * 60
          : 0,
  };
}

type Cam = { x: number; y: number; z: number; rx: number; ry: number };

/** Focus point (window px), zoom and tilt. The window is 1600×1000. */
const camera: ({ at: number } & Cam)[] = [
  { at: 0, x: 800, y: 560, z: 0.8, rx: 26, ry: 0 },
  { at: T.windowIn, x: 800, y: 560, z: 0.8, rx: 26, ry: 0 },
  { at: T.windowIn + 1900, x: 800, y: 500, z: 0.94, rx: 0, ry: 0 },
  { at: T.typeFrom - 200, x: 800, y: 500, z: 0.94, rx: 0, ry: 0 },
  { at: T.typeFrom + 900, x: 925, y: 560, z: 1.55, rx: 0, ry: -3 },
  { at: T.send, x: 950, y: 590, z: 1.6, rx: 0, ry: -2 },
  { at: T.send + 900, x: 900, y: 420, z: 1.2, rx: 0, ry: 0 },
  { at: T.turnFrom + 2600, x: 925, y: 400, z: 1.3, rx: 0, ry: 2 },
  { at: T.splitWaits - 500, x: 925, y: 400, z: 1.3, rx: 0, ry: 2 },
  { at: T.splitWaits + 300, x: 40, y: 330, z: 1.85, rx: 0, ry: 8 },
  { at: T.cmdTo, x: 40, y: 345, z: 1.85, rx: 0, ry: 8 },
  { at: T.cmdTo + 900, x: 925, y: 470, z: 1.28, rx: 0, ry: 0 },
  { at: T.changesFrom, x: 925, y: 470, z: 1.28, rx: 0, ry: 0 },
  { at: T.changesFrom + 1100, x: 800, y: 500, z: 0.94, rx: 0, ry: 0 },
  { at: T.changesFrom + 2000, x: 1180, y: 330, z: 1.45, rx: 0, ry: -4 },
  { at: T.terminalFrom - 400, x: 1260, y: 420, z: 1.45, rx: 0, ry: -4 },
  { at: T.terminalFrom + 400, x: 800, y: 700, z: 1.12, rx: 4, ry: 0 },
  { at: T.terminalTo - 600, x: 780, y: 740, z: 1.2, rx: 4, ry: 0 },
  { at: T.terminalTo + 200, x: 800, y: 500, z: 0.94, rx: 0, ry: 0 },
  { at: T.reviewFrom + 700, x: 800, y: 500, z: 0.94, rx: 0, ry: 0 },
  { at: T.reviewFrom + 1700, x: 925, y: 440, z: 1.3, rx: 0, ry: 0 },
  { at: T.reportFrom - 300, x: 925, y: 470, z: 1.3, rx: 0, ry: 0 },
  { at: T.reportFrom + 900, x: 925, y: 470, z: 1.22, rx: 0, ry: 0 },
  { at: T.themesFrom - 300, x: 925, y: 470, z: 1.22, rx: 0, ry: 0 },
  { at: T.themesFrom + 900, x: 1060, y: 500, z: 0.7, rx: 8, ry: 14 },
  { at: T.outroFrom - 400, x: 1020, y: 500, z: 0.74, rx: 6, ry: 20 },
  { at: T.outroFrom + 1400, x: 800, y: 520, z: 0.6, rx: 18, ry: 0 },
  { at: DURATION, x: 800, y: 520, z: 0.6, rx: 18, ry: 0 },
];

function themeVars(id: string, kind: ThemeKind): CSSProperties {
  const resolved = resolveChoice(kind, { theme: id });
  return {
    ...(tokens(resolved) as CSSProperties),
    colorScheme: kind,
    background: resolved.palette.surface,
    color: resolved.palette.text,
  };
}

function Stage() {
  const t = useTime();
  const cam = keyframes(t, camera, ease.inOut);
  const state = windowState(t);

  const inTheme = t >= T.themesFrom && t < T.outroFrom + 2000;
  const reel = inTheme ? Math.floor((t - T.themesFrom) / T.themeEvery) : 0;
  const slot = clamp(reel, 0, themeReel.length - 1);
  const wipe = inTheme
    ? ease.inOut(span((t - T.themesFrom) % T.themeEvery, 0, 480))
    : 1;
  const current = themeReel[slot];
  const previous = themeReel[Math.max(0, slot - 1)];

  const windowIn = ease.outExpo(span(t, T.windowIn, T.windowIn + 1600));
  const windowOut = ease.inOut(span(t, T.outroFrom, T.outroFrom + 1400));
  const windowOpacity = windowIn * (1 - windowOut);

  const transform = `translate(960px, 540px) rotateX(${cam.rx}deg) rotateY(${cam.ry}deg) scale(${cam.z}) translate(${-cam.x}px, ${-cam.y}px)`;
  // Blurs over the cuts between threads.
  const flash = Math.max(
    0.6 * presence(t, T.send, T.send + 520, 180, 340),
    presence(t, T.reviewFrom - 250, T.reviewFrom + 350, 250, 350),
    presence(t, T.themesFrom - 250, T.themesFrom + 350, 250, 350),
  );

  return (
    <div className="tz-stage">
      <Backdrop t={t} />
      <div className="tz-camera">
        <div
          className="tz-rig"
          style={{
            transform,
            opacity: windowOpacity,
            filter: `blur(${(1 - windowIn) * 14 + windowOut * 10 + flash * 6}px)`,
          }}
        >
          {/* Mounted for the whole reel, so its entry animations are long
              done by the time a wipe shows it. */}
          {inTheme && (
            <AppWindow
              state={state}
              accent={
                resolveChoice(previous.kind, { theme: previous.id }).accent
              }
              style={{
                ...themeVars(previous.id, previous.kind),
                visibility: slot > 0 && wipe < 1 ? "visible" : "hidden",
              }}
              className="tz-under"
            />
          )}
          <AppWindow
            state={state}
            accent={
              inTheme
                ? resolveChoice(current.kind, { theme: current.id }).accent
                : undefined
            }
            style={{
              ...(inTheme ? themeVars(current.id, current.kind) : {}),
              ...(inTheme && slot > 0 && wipe < 1
                ? {
                    maskImage: `linear-gradient(105deg, #000 ${wipe * 130 - 15}%, transparent ${wipe * 130}%)`,
                  }
                : {}),
            }}
          />
          <div className="tz-glare" style={{ opacity: 0.5 + cam.ry / 60 }} />
        </div>
      </div>
      <Scrim t={t} />
      <Captions t={t} themeName={inTheme ? themeById(current.id).name : ""} />
      <Intro t={t} />
      <Outro t={t} />
      <div
        className="tz-fade"
        style={{
          opacity: 1 - span(t, 0, 500) + span(t, DURATION - 700, DURATION),
        }}
      />
    </div>
  );
}

function Backdrop({ t }: { t: number }) {
  const drift = t / 1000;
  return (
    <div className="tz-backdrop">
      <div
        className="tz-orb one"
        style={{
          transform: `translate(${Math.sin(drift * 0.21) * 120}px, ${Math.cos(drift * 0.17) * 70}px)`,
        }}
      />
      <div
        className="tz-orb two"
        style={{
          transform: `translate(${Math.cos(drift * 0.15) * 160}px, ${Math.sin(drift * 0.23) * 90}px)`,
        }}
      />
      <div className="tz-grain" />
    </div>
  );
}

/** A lower-third for text over a zoomed-in window. */
function Scrim({ t }: { t: number }) {
  const on = captions.reduce(
    (v, c) => Math.max(v, presence(t, c.from, c.to, 500, 500)),
    0,
  );
  return <div className="tz-scrim" style={{ opacity: on }} />;
}

const captions: {
  from: number;
  to: number;
  kicker: string;
  title: ReactNode;
  sub?: string;
}[] = [
  {
    from: T.typeFrom + 300,
    to: T.send + 200,
    kicker: "Agents",
    title: "Claude and Codex, in one place.",
    sub: "Pick the model per thread. Your subscriptions, your CLIs.",
  },
  {
    from: T.turnFrom + 900,
    to: T.splitWaits - 300,
    kicker: "Threads",
    title: "Watch every step as it works.",
  },
  {
    from: T.splitWaits + 300,
    to: T.cmdTo + 200,
    kicker: "Activity",
    title: "Run many threads at once.",
    sub: "Relay tells you which one needs you.",
  },
  {
    from: T.changesFrom + 1900,
    to: T.terminalFrom - 300,
    kicker: "Changes",
    title: "Every edit, side by side.",
    sub: "Review the diff right next to the conversation.",
  },
  {
    from: T.terminalFrom + 500,
    to: T.terminalTo - 200,
    kicker: "Terminal",
    title: "Your shell, right under the thread.",
  },
  {
    from: T.reviewFrom + 1500,
    to: T.reportFrom - 200,
    kicker: "Deep review",
    title: "Several models read your changes.",
  },
  {
    from: T.reportFrom + 300,
    to: T.themesFrom - 200,
    kicker: "Deep review",
    title: "One lead checks every finding.",
    sub: "Then fixes what holds up, with you.",
  },
];

function Captions({ t, themeName }: { t: number; themeName: string }) {
  const themeOn = presence(t, T.themesFrom + 600, T.outroFrom - 100, 600, 500);
  return (
    <>
      {captions.map((c) => {
        const p = presence(t, c.from, c.to, 700, 450);
        if (!p) return null;
        const rise = ease.outExpo(span(t, c.from, c.from + 900));
        return (
          <div key={c.from} className="tz-caption" style={{ opacity: p }}>
            <div
              className="tz-kicker"
              style={{ transform: `translateY(${(1 - rise) * 14}px)` }}
            >
              {c.kicker}
            </div>
            <h2
              style={{
                transform: `translateY(${(1 - rise) * 26}px)`,
                filter: `blur(${(1 - rise) * 8}px)`,
              }}
            >
              {c.title}
            </h2>
            {c.sub && (
              <p
                style={{
                  opacity: ease.out(span(t, c.from + 350, c.from + 1000)),
                }}
              >
                {c.sub}
              </p>
            )}
          </div>
        );
      })}
      {themeOn > 0 && (
        <div
          className="tz-caption tz-theme-caption"
          style={{ opacity: themeOn }}
        >
          <div className="tz-kicker">Themes</div>
          <h2>Make it yours.</h2>
          <p>
            Built-in themes, or any VS Code theme from Open VSX.
            <span className="tz-theme-name">{themeName}</span>
          </p>
        </div>
      )}
    </>
  );
}

/** Words that land one after another. */
function Words({
  text,
  t,
  from,
  step = 90,
}: {
  text: string;
  t: number;
  from: number;
  step?: number;
}) {
  return (
    <>
      {text.split(" ").map((word, i) => {
        const p = ease.outExpo(span(t, from + i * step, from + i * step + 900));
        return (
          <span
            key={i}
            className="tz-word"
            style={{
              opacity: p,
              transform: `translateY(${(1 - p) * 0.5}em)`,
              filter: `blur(${(1 - p) * 10}px)`,
            }}
          >
            {word}{" "}
          </span>
        );
      })}
    </>
  );
}

function Intro({ t }: { t: number }) {
  if (t > T.windowIn + 800) return null;
  const mark = ease.outExpo(span(t, 300, 1700));
  const word = ease.outExpo(span(t, 1000, 2100));
  const out = ease.in(span(t, T.windowIn - 500, T.windowIn + 500));
  return (
    <div
      className="tz-title"
      style={{
        opacity: 1 - out,
        transform: `scale(${1 + out * 0.18})`,
        filter: `blur(${out * 12}px)`,
      }}
    >
      <div className="tz-lockup">
        <div
          className="tz-mark"
          style={{
            opacity: mark,
            transform: `translateX(${(1 - word) * 130}px) scale(${mixN(0.7, 1, mark)}) rotate(${(1 - mark) * -25}deg)`,
          }}
        >
          <div className="tz-mark-glow" style={{ opacity: mark * 0.9 }} />
          <RelayMark size={168} />
        </div>
        <div
          className="tz-wordmark"
          style={{ clipPath: `inset(-20% ${(1 - word) * 100}% -20% 0)` }}
        >
          Relay
        </div>
      </div>
      <p className="tz-tagline">
        <Words
          t={t}
          from={1900}
          text="Your agents, your code and your reviews."
        />
        <br />
        <Words t={t} from={2350} text="One workspace." />
      </p>
    </div>
  );
}

function Outro({ t }: { t: number }) {
  if (t < T.outroFrom + 500) return null;
  const from = T.outroFrom + 900;
  const mark = ease.outExpo(span(t, from, from + 1400));
  const word = ease.outExpo(span(t, from + 500, from + 1600));
  return (
    <div className="tz-title">
      <div className="tz-lockup">
        <div
          className="tz-mark"
          style={{
            opacity: mark,
            transform: `translateX(${(1 - word) * 130}px) scale(${mixN(0.8, 1, mark)})`,
          }}
        >
          <div className="tz-mark-glow" style={{ opacity: mark * 0.9 }} />
          <RelayMark size={168} />
        </div>
        <div
          className="tz-wordmark"
          style={{ clipPath: `inset(-20% ${(1 - word) * 100}% -20% 0)` }}
        >
          Relay
        </div>
      </div>
      <p className="tz-tagline">
        <Words
          t={t}
          from={from + 1300}
          text="Think it through. Build it. Review it."
        />
      </p>
      <p
        className="tz-platforms"
        style={{ opacity: ease.out(span(t, from + 2600, from + 3400)) }}
      >
        For macOS and Linux
      </p>
    </div>
  );
}

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Stage />
    </QueryClientProvider>
  </StrictMode>,
);

// ?capture: the recorder drives the clock. ?t=: hold one moment. Otherwise play.
const params = new URLSearchParams(location.search);
if (params.has("capture")) {
  document.documentElement.dataset.capture = "";
  window.teaser = {
    seek,
    duration: DURATION,
    ready: document.fonts.ready.then(() => {}),
  };
} else {
  if (params.has("t")) void seek(Number(params.get("t")) * 1000);
  else {
    if (params.has("from")) void seek(Number(params.get("from")) * 1000);
    play();
  }
  // Fit the 1920×1080 stage to the tab.
  const fit = () =>
    document.documentElement.style.setProperty(
      "--fit",
      String(Math.min(innerWidth / 1920, innerHeight / 1080)),
    );
  fit();
  addEventListener("resize", fit);
}
