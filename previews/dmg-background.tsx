// The window the DMG opens into. Finder paints the background image and draws
// the two icons and their labels on top at fixed spots, so each option here is
// only the background; the icons and labels are mocked to judge the whole.
// Finder draws those labels black over a background image, even in dark mode
// (checked on macOS 15), so a background has to be light where they sit.
// ?export=<option>[&hint=1] renders the bare background for screenshotting.
// Open http://127.0.0.1:5177/previews/dmg-background.html
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HardDriveDownload } from "lucide-react";
import "../src/styles.css";
import "./chrome.css";
import "./dmg-background.css";
import { initAppearance, setMode, useAppearance } from "../src/lib/appearance";
import iconUrl from "../assets/icon.png";
import markUrl from "../assets/relay-mark.svg";

initAppearance();

/** Background size in points; the window's content area matches it. */
export const WIDTH = 600;
export const HEIGHT = 400;
/** Icon centres, as electron-builder's dmg.contents x/y take them. */
export const APP_AT = { x: 170, y: 220 };
export const APPLICATIONS_AT = { x: 430, y: 220 };
export const ICON_SIZE = 100;

type Option = "handoff-shelf" | "handoff-light" | "handoff" | "ribbon" | "midnight" | "dusk" | "line";

const options: { value: Option; label: string; note: string }[] = [
  {
    value: "handoff-shelf",
    label: "Handoff shelf",
    note: "Dark Handoff; the icons stand on a pale shelf so Finder's black labels stay readable.",
  },
  {
    value: "handoff-light",
    label: "Handoff light",
    note: "Handoff on warm paper, so Finder's black labels stay readable.",
  },
  {
    value: "handoff",
    label: "Handoff dark",
    note: "Midnight's background, the mark beside Relay, the mono caption and the relay line.",
  },
  {
    value: "ribbon",
    label: "Ribbon",
    note: "Warm paper, the icon's lavender ribbon swoops across.",
  },
  {
    value: "midnight",
    label: "Midnight",
    note: "Near-black with a glow behind Relay. Matches the icon tile. Finder's black labels vanish on it.",
  },
  {
    value: "dusk",
    label: "Dusk",
    note: "Mid-tone lavender; black labels are readable but muddy.",
  },
  {
    value: "line",
    label: "Relay line",
    note: "White, one hairline handing Relay over to Applications, mono caption.",
  },
];

function Hint({ tone }: { tone: "light" | "dark" }) {
  return (
    <div className={`dmg-hint dmg-hint-${tone}`}>
      Blocked on first launch? Run <code>xattr -cr /Applications/Relay.app</code>
    </div>
  );
}

function Ribbon({ hint }: { hint: boolean }) {
  return (
    <div className="dmg-bg dmg-ribbon">
      <div className="dmg-title dmg-title-light">
        <strong>Relay</strong>
        <span>Drag into Applications to install</span>
      </div>
      <svg className="dmg-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        <defs>
          <linearGradient id="ribbon-ink" x1="0" x2="1">
            <stop offset="0" stopColor="#d9d6fb" />
            <stop offset="0.55" stopColor="#9d99e0" />
            <stop offset="1" stopColor="#6565a9" />
          </linearGradient>
        </defs>
        <path
          d="M236 214 C 268 160, 318 158, 330 196 C 340 228, 302 236, 300 210 C 298 184, 338 176, 362 214"
          fill="none"
          stroke="url(#ribbon-ink)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M350 204 L 364 216 L 346 222"
          fill="none"
          stroke="#6565a9"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {hint && <Hint tone="light" />}
    </div>
  );
}

function Midnight({ hint }: { hint: boolean }) {
  return (
    <div className="dmg-bg dmg-midnight">
      <div className="dmg-title dmg-title-dark">
        <strong>Relay</strong>
        <span>Drag into Applications to install</span>
      </div>
      <svg className="dmg-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        {[0, 1, 2].map((i) => (
          <path
            key={i}
            d={`M${282 + i * 16} 206 l 10 14 l -10 14`}
            fill="none"
            stroke="#aaa8e5"
            strokeOpacity={0.3 + i * 0.3}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      {hint && <Hint tone="dark" />}
    </div>
  );
}

function Dusk({ hint }: { hint: boolean }) {
  return (
    <div className="dmg-bg dmg-dusk">
      <div className="dmg-title dmg-title-dusk">
        <strong>Relay</strong>
        <span>Drag into Applications to install</span>
      </div>
      <svg className="dmg-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        <path
          d="M250 220 H 342"
          stroke="#fff"
          strokeOpacity="0.85"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="0.1 10"
        />
        <path
          d="M340 210 L 352 220 L 340 230"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {hint && <Hint tone="dark" />}
    </div>
  );
}

function Line({ hint }: { hint: boolean }) {
  return (
    <div className="dmg-bg dmg-line">
      <div className="dmg-title dmg-title-mono">
        <span>relay → /Applications</span>
      </div>
      <svg className="dmg-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        <line x1="236" y1="220" x2="364" y2="220" stroke="#6565a9" strokeWidth="1.5" />
        <circle cx="236" cy="220" r="4" fill="#fff" stroke="#6565a9" strokeWidth="1.5" />
        <circle cx="364" cy="220" r="4" fill="#6565a9" />
      </svg>
      {hint && <Hint tone="light" />}
    </div>
  );
}

function Handoff({ hint, light, shelf }: { hint: boolean; light?: boolean; shelf?: boolean }) {
  const ink = light ? "#6565a9" : "#aaa8e5";
  return (
    <div className={`dmg-bg ${light ? "dmg-paper" : "dmg-midnight"}`}>
      <div className={`dmg-title ${light ? "dmg-title-light" : "dmg-title-dark"}`}>
        <strong className="dmg-wordmark">
          <img src={markUrl} alt="" />
          Relay
        </strong>
        <span className="dmg-caption-mono">relay → /Applications</span>
      </div>
      <svg className="dmg-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden>
        <line x1="236" y1="220" x2="364" y2="220" stroke={ink} strokeWidth="1.5" />
        <circle cx="236" cy="220" r="4" fill={light ? "#f7f6f2" : "#141418"} stroke={ink} strokeWidth="1.5" />
        <circle cx="364" cy="220" r="4" fill={ink} />
      </svg>
      {shelf && <div className="dmg-shelf" />}
      {hint && <Hint tone={light || shelf ? "light" : "dark"} />}
    </div>
  );
}

function Background({ option, hint }: { option: Option; hint: boolean }) {
  if (option === "handoff-shelf") return <Handoff hint={hint} shelf />;
  if (option === "handoff-light") return <Handoff hint={hint} light />;
  if (option === "handoff") return <Handoff hint={hint} />;
  if (option === "ribbon") return <Ribbon hint={hint} />;
  if (option === "midnight") return <Midnight hint={hint} />;
  if (option === "dusk") return <Dusk hint={hint} />;
  return <Line hint={hint} />;
}

/** Stand-in for macOS's Applications folder alias; Finder draws the real one. */
function ApplicationsIcon() {
  return (
    <svg viewBox="0 0 100 100" width={ICON_SIZE} height={ICON_SIZE} aria-hidden>
      <path d="M8 26 a6 6 0 0 1 6 -6 h24 l8 7 h40 a6 6 0 0 1 6 6 v4 H8 Z" fill="#4fa3e8" />
      <rect x="6" y="32" width="88" height="56" rx="6" fill="#8ccaf7" />
      <path
        d="M50 44 L 38 76 M50 44 L 62 76 M40 66 H 60"
        stroke="#4f97d8"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path d="M8 96 l 10 -10 m -7 0 h 7 v 7" stroke="#222" strokeWidth="3" fill="none" />
    </svg>
  );
}

function Placed({ at, label, children }: {
  at: { x: number; y: number };
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="dmg-item"
      style={{ left: at.x - ICON_SIZE / 2, top: at.y - ICON_SIZE / 2, width: ICON_SIZE }}
    >
      {children}
      <span>{label}</span>
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
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

function App() {
  const appearance = useAppearance();
  const [option, setOption] = useState<Option>("handoff-shelf");
  const [hint, setHint] = useState(false);
  const note = options.find((o) => o.value === option)!.note;

  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>
          <HardDriveDownload size={14} /> DMG window
        </strong>
        <span className="preview-tag">Preview · sample</span>
        <div className="preview-control">
          <span>Background</span>
          <Segmented<Option>
            label="Background"
            value={option}
            onChange={setOption}
            options={options.map(({ value, label }) => ({ value, label }))}
          />
        </div>
        <label className="preview-control">
          <input type="checkbox" checked={hint} onChange={(e) => setHint(e.target.checked)} />
          Unsigned-build hint
        </label>
        <span className="spacer" />
        <Segmented<string>
          label="Colour mode"
          value={appearance.palette.kind}
          onChange={(v) => setMode(v as "light" | "dark")}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </div>
      <div className="dmg-stage">
        <div className="dmg-window">
          <div className="dmg-titlebar">
            <span className="dmg-lights" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <img src={iconUrl} alt="" />
            Relay 0.1.20-arm64
          </div>
          <div className="dmg-content" style={{ width: WIDTH, height: HEIGHT }}>
            <Background option={option} hint={hint} />
            <Placed at={APP_AT} label="Relay">
              <img src={iconUrl} alt="" width={ICON_SIZE} height={ICON_SIZE} />
            </Placed>
            <Placed at={APPLICATIONS_AT} label="Applications">
              <ApplicationsIcon />
            </Placed>
          </div>
        </div>
        <p className="dmg-note">{note}</p>
      </div>
    </div>
  );
}

function Export({ option, hint }: { option: Option; hint: boolean }) {
  return (
    <div className="dmg-export" style={{ width: WIDTH, height: HEIGHT }}>
      <Background option={option} hint={hint} />
    </div>
  );
}

const params = new URLSearchParams(location.search);
const exported = params.get("export") as Option | null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {exported ? <Export option={exported} hint={params.get("hint") === "1"} /> : <App />}
  </StrictMode>,
);
