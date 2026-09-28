// Check for updates in Settings → About, on a simulated updater. Orbit is the
// control the app ships; Warp and Morph are other looks to compare. Sample
// data, the app's own styles and components.
// Open http://127.0.0.1:5177/previews/update-check.html
import "./desktop-stub";
import {
  StrictMode,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Check,
  Info,
  Keyboard,
  ListTodo,
  Palette,
  Search,
  Smartphone,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "../src/styles.css";
import "../src/components/settings.css";
import "../src/components/relay-mark.css";
import "./ci-status.css";
import "./update-check.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import { useUpdates } from "../src/lib/updates";
import { RelayMark } from "../src/components/RelayMark";
import { IconButton, Spinner } from "../src/components/ui";
import { Settings } from "../src/components/Settings";
import { defaultAISettings } from "../shared/settings";
import {
  UpdateActionButton,
  UpdateBadge,
  UpdateCheck,
  UpdateConfetti,
  updateLine,
  useLinger,
  useUpdateCheck,
} from "../src/components/UpdateCheck";
import type { Api } from "../shared/types";
import type { UpdateState } from "../shared/updates";

initAppearance();
initWindowFocus();

/* A stand-in for electron/updater.ts, answering however the bar says. */
type Answer = "latest" | "newer" | "manual" | "offline";
const sim = {
  answer: "latest" as Answer,
  latency: 150,
  current: "0.1.23",
  next: "0.1.24",
};
let state: UpdateState = { status: "idle", current: sim.current };
const listeners = new Set<(state: UpdateState) => void>();
const set = (next: UpdateState) => {
  state = next;
  for (const listener of listeners) listener(next);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

Object.assign(window.relay as Partial<Api>, {
  updateState: async () => state,
  onUpdate: (callback: (state: UpdateState) => void) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },
  checkForUpdates: async () => {
    const { current, next } = sim;
    set({ status: "checking", current });
    await wait(sim.latency);
    if (sim.answer === "offline") {
      set({ status: "idle", current });
      throw new Error("Couldn't reach github.com.");
    }
    if (sim.answer === "latest")
      set({ status: "idle", current, checkedAt: Date.now() });
    else
      set({
        status: "available",
        current,
        version: next,
        notes: "Sample release notes.",
        install: sim.answer === "manual" ? "manual" : "auto",
        ...(sim.answer === "manual" && {
          reason: "Move Relay to Applications to enable automatic updates.",
        }),
      });
    return state;
  },
  downloadUpdate: async () => {
    const { current, next: version } = sim;
    for (let i = 0; i <= 40; i++) {
      set({ status: "downloading", current, version, progress: i / 40 });
      await wait(70);
    }
    set({ status: "ready", current, version });
    return state;
  },
  installUpdate: async () => {
    set({ status: "installing", current: sim.current, version: sim.next });
    await wait(1800);
    // Back from the restart on the new version.
    sim.current = sim.next;
    sim.next = sim.next.replace(/\d+$/, (n) => String(Number(n) + 1));
    set({ status: "idle", current: sim.current });
    return state;
  },
  openExternal: async (url: string) => void window.open(url, "_blank"),
  // Enough for the real Settings dialog to open on About.
  aiSettings: async () => defaultAISettings,
});
const queryClient = new QueryClient();

function reset() {
  sim.current = "0.1.23";
  sim.next = "0.1.24";
  set({ status: "idle", current: sim.current });
}

/* Warp: the mark jumps to light speed inside a porthole. Fixed streaks, so
   every run looks alike. */
const streaks = Array.from({ length: 18 }, (_, i) => ({
  "--a": `${i * 20 + ((i * 37) % 11) - 5}deg`,
  "--d": `${((i * 7) % 9) * 0.06}s`,
  "--t": `${0.42 + ((i * 5) % 4) * 0.07}s`,
}));

function WarpCheck() {
  const { action, phase, live } = useUpdateCheck();
  const warping = useLinger(phase === "busy", 350);
  return (
    <div
      className="update-check warp"
      data-phase={phase}
      data-live={live || undefined}
    >
      {action && <UpdateActionButton action={action} />}
      <span className="update-orb">
        {warping && (
          <span className="warp-field" aria-hidden="true">
            {streaks.map((style, i) => (
              <i key={i} style={style as CSSProperties} />
            ))}
          </span>
        )}
        <RelayMark size={28} />
        {live && phase !== "busy" && <i className="warp-flash" />}
        {live && phase === "found" && <UpdateConfetti />}
        <UpdateBadge phase={phase} />
      </span>
    </div>
  );
}

/* Morph: the button folds into a spinner and unfolds into the answer. */
function MorphCheck() {
  const { action, phase, live } = useUpdateCheck();
  if (!action) return <RelayMark size={28} />;
  const busy = phase === "busy";
  // Just after a watched check, the button says so until it's pressed again.
  const settled = live && phase === "latest";
  const Icon = action.icon;
  return (
    <div className="morph" data-phase={phase} data-live={live || undefined}>
      <button
        type="button"
        className={`morph-button ${action.primary ? "primary" : ""}`}
        disabled={!action.run}
        title={settled ? "Check again" : action.title}
        onClick={action.run}
      >
        {busy && <Spinner size={16} />}
        <span className="morph-label" key={settled ? "settled" : action.label}>
          {settled ? (
            <svg className="morph-check" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2.5 7.5 5.6 10.4 11.5 3.8" />
            </svg>
          ) : (
            Icon && <Icon size={14} />
          )}
          {settled ? "Up to date" : action.label}
        </span>
      </button>
      <RelayMark size={28} />
    </div>
  );
}

type Look = "orbit" | "warp" | "morph";
const looks: { value: Look; label: string; note: ReactNode }[] = [
  {
    value: "orbit",
    label: "Orbit",
    note: "A comet circles the mark while Relay asks GitHub, then falls in: a green check ripples out, a new version bursts into confetti, or the mark shakes its head. The same ring fills as the update downloads. This is the one wired into the app.",
  },
  {
    value: "warp",
    label: "Warp",
    note: "The mark jumps to light speed inside a porthole while Relay asks, and drops out with a flash. A new version gets the same confetti.",
  },
  {
    value: "morph",
    label: "Morph",
    note: "The button folds into a spinner, then unfolds into the answer: a drawn check, the update, or Try again. The mark stays still.",
  },
];
const answers: { value: Answer; label: string }[] = [
  { value: "latest", label: "Up to date" },
  { value: "newer", label: "New version" },
  { value: "manual", label: "Manual download" },
  { value: "offline", label: "Offline" },
];
const networks = [
  { value: "150", label: "Quick" },
  { value: "3000", label: "Slow" },
];
const categories = [
  ["Appearance", Palette],
  ["Account", UserRound],
  ["AI models", Sparkles],
  ["Integrations", ListTodo],
  ["Shared rooms", Users],
  ["Phone", Smartphone],
  ["Keyboard shortcuts", Keyboard],
  ["About", Info],
] as const;

function App() {
  const appearance = useAppearance();
  const updates = useUpdates();
  const [look, setLook] = useState<Look>("orbit");
  const [answer, setAnswer] = useState(sim.answer);
  const [latency, setLatency] = useState(String(sim.latency));
  // Remounts the control so a reset forgets the last check's flourish.
  const [run, setRun] = useState(0);
  const [realDialog, setRealDialog] = useState(false);
  const control =
    look === "orbit" ? (
      <UpdateCheck key={run} />
    ) : look === "warp" ? (
      <WarpCheck key={run} />
    ) : (
      <MorphCheck key={run} />
    );
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>Check for updates</strong>
        <span className="preview-tag">Preview · sample data</span>
        <div className="preview-control">
          <span>Look</span>
          <Segmented
            label="Look"
            value={look}
            onChange={setLook}
            options={looks}
          />
        </div>
        <div className="preview-control">
          <span>GitHub answers</span>
          <Segmented
            label="GitHub answers"
            value={answer}
            onChange={(value) => setAnswer((sim.answer = value))}
            options={answers}
          />
        </div>
        <div className="preview-control">
          <span>Network</span>
          <Segmented
            label="Network"
            value={latency}
            onChange={(value) => {
              sim.latency = Number(value);
              setLatency(value);
            }}
            options={networks}
          />
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="uc-reset"
          title="The app's own Settings dialog, with Orbit"
          onClick={() => setRealDialog(true)}
        >
          Open real Settings
        </button>
        <button
          type="button"
          className="uc-reset"
          onClick={() => {
            reset();
            setRun((n) => n + 1);
          }}
        >
          Reset
        </button>
        <Segmented
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <div className="uc-stage">
        <div className="settings-screen uc-sheet">
          <aside className="settings-nav">
            <h2>Settings</h2>
            <div className="settings-search">
              <Search size={14} />
              <input
                aria-label="Search settings"
                placeholder="Search settings"
              />
            </div>
            <nav aria-label="Settings categories">
              {categories.map(([label, Icon]) => (
                <button
                  key={label}
                  type="button"
                  className={label === "About" ? "active" : ""}
                >
                  <Icon size={15} />
                  <span>{label}</span>
                </button>
              ))}
            </nav>
          </aside>
          <main className="settings-pane">
            <header>
              <div>
                <h3>About</h3>
                <p>Version and credits.</p>
              </div>
              <IconButton label="Close dialog">
                <X size={17} />
              </IconButton>
            </header>
            <div className="settings-content">
              <section className="setting" aria-label="Relay">
                <div className="setting-text">
                  <h4>Relay</h4>
                  <p>{updateLine(updates)}</p>
                </div>
                <div className="setting-control">{control}</div>
              </section>
              <section className="setting" aria-label="Credits">
                <div className="setting-text">
                  <h4>Credits</h4>
                  <p>Built with code from T3 Code.</p>
                </div>
                <div className="setting-control">
                  <a href="https://github.com/pingdotgg/t3code">
                    T3 Code on GitHub
                  </a>
                </div>
              </section>
            </div>
          </main>
        </div>
        <p className="uc-note">
          <Check size={13} />
          {looks.find((l) => l.value === look)!.note}
        </p>
      </div>
      {realDialog && (
        <Settings
          account={null}
          initialCategory="about"
          onClose={() => setRealDialog(false)}
          onDisconnect={async () => {}}
        />
      )}
    </div>
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
