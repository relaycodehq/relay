// Three ways to show installed VS Code themes more compactly. The installed
// extensions are real, fetched from Open VSX and mapped with Relay's own
// theme mapping; installing and removing are sample actions.
// Open http://127.0.0.1:5177/previews/installed-themes.html
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Moon, Search, Sun, Trash2 } from "lucide-react";
import "../../src/styles.css";
import "../../src/features/settings/settings.css";
import "./installed-themes.css";
import { initAppearance } from "../../src/lib/appearance";
import { fetchThemes, type VsCodeTheme } from "../../shared/open-vsx";
import { paletteFromVsCode } from "../../src/lib/vscode-theme";
import type { Palette } from "../../src/lib/themes";
import { IconButton } from "../../src/ui/ui";
import { SettingsCard, SettingsRow } from "../../src/ui/SettingsCard";

initAppearance();

interface Installed {
  name: string;
  publisher: string;
  version: string;
  themes: { label: string; palette: Palette }[];
}

const samples = [
  {
    namespace: "zhuangtongfa",
    name: "material-theme",
    version: "3.20.2",
    displayName: "One Dark Pro",
  },
  {
    namespace: "GitHub",
    name: "github-vscode-theme",
    version: "6.3.5",
    displayName: "GitHub Theme",
  },
  {
    namespace: "LhacenMed",
    name: "cursor-noir",
    version: "1.0.1",
    displayName: "Cursor Noir",
  },
];

async function loadSamples(): Promise<Installed[]> {
  return Promise.all(
    samples.map(async (s) => ({
      name: s.displayName,
      publisher: s.namespace,
      version: s.version,
      themes: (await fetchThemes(s)).map((t: VsCodeTheme) => ({
        label: t.label,
        palette: paletteFromVsCode(t, "sample"),
      })),
    })),
  );
}

/** How many themes of each mode, as quiet text. */
function counts(themes: Installed["themes"]) {
  const dark = themes.filter((t) => t.palette.kind === "dark").length;
  const light = themes.length - dark;
  return (
    <span className="installed-counts">
      {dark > 0 && (
        <span>
          <Moon size={11} /> {dark}
        </span>
      )}
      {light > 0 && (
        <span>
          <Sun size={11} /> {light}
        </span>
      )}
    </span>
  );
}

/** Each theme as its background with its accent in the middle. */
function Swatches({
  themes,
  active,
  onPick,
}: {
  themes: Installed["themes"];
  active?: string;
  onPick: (label: string) => void;
}) {
  return (
    <span className="installed-swatches">
      {themes.map(({ label, palette }) => (
        <button
          key={label}
          className={`installed-swatch ${active === label ? "selected" : ""}`}
          title={label}
          aria-label={`Use ${label}`}
          aria-pressed={active === label}
          onClick={() => onPick(label)}
          style={{
            background: `radial-gradient(circle, ${palette.accent} 0 3px, ${palette.surface} 3.5px)`,
          }}
        />
      ))}
    </span>
  );
}

function Remove({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <IconButton label={`Remove ${name}`} onClick={onRemove}>
      <Trash2 size={14} />
    </IconButton>
  );
}

// Option A: one quiet line per extension ------------------------------------

function CompactList({ installed, remove }: OptionProps) {
  return (
    <SettingsCard className="installed-compact">
      {installed.map((e) => (
        <div key={e.name} className="installed-row">
          <strong>{e.name}</strong>
          <small>
            {e.publisher} · {e.version}
          </small>
          {counts(e.themes)}
          <Remove name={e.name} onRemove={() => remove(e.name)} />
        </div>
      ))}
    </SettingsCard>
  );
}

// Option B: one line per extension, its themes as swatches you can pick -----

function SwatchList({ installed, remove, active, pick }: OptionProps) {
  const hovered = installed
    .flatMap((e) => e.themes)
    .find((t) => t.label === active);
  return (
    <SettingsCard className="installed-compact">
      {installed.map((e) => (
        <div key={e.name} className="installed-row">
          <strong>{e.name}</strong>
          <small>{e.publisher}</small>
          <Swatches themes={e.themes} active={active} onPick={pick} />
          <Remove name={e.name} onRemove={() => remove(e.name)} />
        </div>
      ))}
      <div className="installed-caption">
        {hovered
          ? `Using ${hovered.label}.`
          : "Click a swatch to use that theme; hover for its name."}
      </div>
    </SettingsCard>
  );
}

// Option C: Browse and Installed share one list ------------------------------

function Tabs(props: OptionProps) {
  const [tab, setTab] = useState<"browse" | "installed">("installed");
  return (
    <>
      <div className="installed-tabs">
        <div className="segmented settings-segmented">
          <button
            className={tab === "browse" ? "active" : ""}
            onClick={() => setTab("browse")}
          >
            Browse Open VSX
          </button>
          <button
            className={tab === "installed" ? "active" : ""}
            onClick={() => setTab("installed")}
          >
            Installed · {props.installed.length}
          </button>
        </div>
      </div>
      {tab === "installed" ? (
        <SwatchList {...props} />
      ) : (
        <>
          <SearchBox />
          <SettingsCard>
            <SettingsRow
              label="Search results"
              hint="The paged Open VSX results take this whole space."
            />
          </SettingsCard>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

interface OptionProps {
  installed: Installed[];
  remove: (name: string) => void;
  active?: string;
  pick: (label: string) => void;
}

function SearchBox() {
  return (
    <div className="settings-search">
      <Search size={14} />
      <input placeholder="Search VS Code themes on Open VSX" readOnly />
    </div>
  );
}

const options = [
  {
    id: "a",
    label: "A · Compact list",
    render: (p: OptionProps) => (
      <>
        <CompactList {...p} />
        <SearchBox />
      </>
    ),
  },
  {
    id: "b",
    label: "B · Swatches",
    render: (p: OptionProps) => (
      <>
        <SwatchList {...p} />
        <SearchBox />
      </>
    ),
  },
  {
    id: "c",
    label: "C · Installed tab",
    render: (p: OptionProps) => <Tabs {...p} />,
  },
  { id: "now", label: "Current", render: null },
] as const;

function Current({ installed, remove }: OptionProps) {
  return (
    <>
      <SettingsCard>
        {installed.map((e) => (
          <SettingsRow
            key={e.name}
            label={e.name}
            hint={
              <>
                {e.publisher} · {e.version}
                <span className="theme-import-variants">
                  {e.themes.map((t) => (
                    <span key={t.label}>
                      {t.palette.kind === "light" ? (
                        <Sun size={11} />
                      ) : (
                        <Moon size={11} />
                      )}
                      {t.label}
                    </span>
                  ))}
                </span>
              </>
            }
          >
            <button onClick={() => remove(e.name)}>
              <Trash2 size={12} />
              Remove
            </button>
          </SettingsRow>
        ))}
      </SettingsCard>
      <SearchBox />
    </>
  );
}

function Preview() {
  const [installed, setInstalled] = useState<Installed[]>();
  const [error, setError] = useState<string>();
  const [option, setOption] = useState<string>(
    () => new URLSearchParams(location.search).get("option") ?? "b",
  );
  const [active, setActive] = useState<string>();
  useEffect(() => {
    loadSamples().then(setInstalled, (e) => setError(String(e)));
  }, []);
  const props: OptionProps | undefined = installed && {
    installed,
    remove: (name) => setInstalled(installed.filter((e) => e.name !== name)),
    active,
    pick: setActive,
  };
  const chosen = options.find((o) => o.id === option)!;
  return (
    <div className="installed-page">
      <div className="installed-switcher">
        <div className="segmented">
          {options.map((o) => (
            <button
              key={o.id}
              className={o.id === option ? "active" : ""}
              onClick={() => setOption(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span>
          Installed extensions are real (fetched from Open VSX); remove and pick
          are sample actions.
        </span>
      </div>
      <div className="settings-screen installed-sheet">
        <main className="settings-pane">
          <div className="settings-content">
            <div className="settings-group">
              <section className="setting block" aria-label="VS Code themes">
                <div className="setting-text">
                  <h4>VS Code themes</h4>
                  <p>
                    Install any colour theme from Open VSX. Its themes join the
                    light and dark lists above, code colours included.
                  </p>
                </div>
                <div className="setting-control">
                  <div className="theme-import">
                    {error && <p>{error}</p>}
                    {!props && !error && (
                      <p className="setting-muted">Fetching sample themes…</p>
                    )}
                    {props &&
                      (chosen.render ? (
                        chosen.render(props)
                      ) : (
                        <Current {...props} />
                      ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
