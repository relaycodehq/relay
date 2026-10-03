// Settings → Plugins, three redesigns on sample data. The settings sheet is
// drawn here (no dialog) so option B can add plugin pages to the nav.
// Open http://127.0.0.1:5177/previews/plugins-page.html (?o=stack|pages|readout)
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ChevronRight,
  Info,
  Keyboard,
  ListTodo,
  Mic,
  MonitorUp,
  Moon,
  Palette,
  Search,
  Smartphone,
  Sparkles,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/features/settings/settings.css";
import "../../src/features/plugins/plugins.css";
import "./plugins-page.css";
import { initAppearance, setMode } from "../../src/lib/appearance";
import { IconButton } from "../../src/ui/ui";
import {
  PluginsIcon,
  connected,
  fresh,
  meta,
  needsSetup,
  pluginIds,
  type PluginId,
  type PluginsState,
} from "./plugins-page-data";
import type { SetPlugin } from "./plugins-page-parts";
import {
  PagesOverview,
  PagesPlugin,
  Readout,
  Stack,
} from "./plugins-page-options";

initAppearance();

const options = [
  { id: "stack", label: "A · Stack" },
  { id: "pages", label: "B · Pages" },
  { id: "readout", label: "C · Readout" },
] as const;
type OptionId = (typeof options)[number]["id"];

const nav = [
  { label: "Appearance", icon: Palette },
  { label: "Account", icon: UserRound },
  { label: "AI models", icon: Sparkles },
  { label: "Integrations", icon: ListTodo },
  { label: "Plugins", icon: PluginsIcon },
  { label: "Shared rooms", icon: Users },
  { label: "Phone", icon: Smartphone },
  { label: "Computers", icon: MonitorUp },
  { label: "Dictation", icon: Mic },
  { label: "Keyboard shortcuts", icon: Keyboard },
  { label: "About", icon: Info },
];

function Preview() {
  const initial = new URLSearchParams(location.search).get("o");
  const [option, setOption] = useState<OptionId>(
    options.some((o) => o.id === initial) ? (initial as OptionId) : "stack",
  );
  const [sample, setSample] = useState<"connected" | "fresh">("connected");
  const [state, setState] = useState<PluginsState>(connected);
  const [savedAt, setSavedAt] = useState<Partial<Record<PluginId, number>>>({});
  const [page, setPage] = useState<PluginId>();
  const [dark, setDark] = useState(
    () =>
      JSON.parse(localStorage.getItem("relay-appearance") ?? "{}").mode !==
      "light",
  );

  const set: SetPlugin = (id, patch) => {
    setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
    if (!("on" in patch)) setSavedAt((a) => ({ ...a, [id]: Date.now() }));
  };
  const pick = (o: OptionId) => {
    setOption(o);
    setPage(undefined);
    history.replaceState(null, "", `?o=${o}`);
  };
  const reset = (which: "connected" | "fresh") => {
    setSample(which);
    setState(which === "connected" ? connected : fresh);
    setSavedAt({});
    for (const key of Object.keys(localStorage))
      if (key.startsWith("pl-")) localStorage.removeItem(key);
  };

  const onPluginPage = option === "pages" && page;
  return (
    <div className="pl-preview">
      <div className="pl-toolbar">
        <div className="segmented">
          {options.map((o) => (
            <button
              key={o.id}
              className={o.id === option ? "active" : ""}
              onClick={() => pick(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="segmented">
          {(["connected", "fresh"] as const).map((s) => (
            <button
              key={s}
              className={s === sample ? "active" : ""}
              onClick={() => reset(s)}
            >
              {s === "connected" ? "Set up" : "Fresh install"}
            </button>
          ))}
        </div>
        <IconButton
          label="Toggle colour mode"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <span className="pl-sample-label">
          Sample data. Edits save as you go; nothing leaves the page.
        </span>
      </div>

      <div className="settings-screen pl-sheet">
        <aside className="settings-nav">
          <h2>Settings</h2>
          <div className="settings-search">
            <Search size={14} />
            <input aria-label="Search settings" placeholder="Search settings" />
          </div>
          <nav aria-label="Settings categories">
            {nav.map(({ label, icon: Icon }) => {
              const plugins = label === "Plugins";
              return (
                <div key={label} className="pl-nav-item">
                  <button
                    className={plugins && !onPluginPage ? "active" : ""}
                    disabled={!plugins}
                    onClick={() => setPage(undefined)}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                  {plugins && option === "pages" && (
                    <div className="pl-nav-children">
                      {pluginIds
                        .filter((id) => state[id].on)
                        .map((id) => (
                          <button
                            key={id}
                            className={page === id ? "active" : ""}
                            onClick={() => setPage(id)}
                          >
                            <span>{meta[id].short}</span>
                            {needsSetup(id, state) && (
                              <i
                                className="pl-nav-dot"
                                aria-label="Needs setup"
                              />
                            )}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>
        <main className="settings-pane">
          <header>
            <div>
              {onPluginPage ? (
                <>
                  <button
                    className="pl-crumb"
                    onClick={() => setPage(undefined)}
                  >
                    Plugins <ChevronRight size={12} />
                  </button>
                  <h3>{meta[page].title}</h3>
                  <p>{meta[page].description}</p>
                </>
              ) : (
                <>
                  <h3>Plugins</h3>
                  <p>
                    Extras that ship with Relay and stay out of sight until you
                    turn them on.
                  </p>
                </>
              )}
            </div>
            <IconButton label="Close dialog">
              <X size={17} />
            </IconButton>
          </header>
          <div key={sample} className="settings-content pl-content">
            {option === "stack" && (
              <Stack state={state} set={set} savedAt={savedAt} />
            )}
            {option === "pages" &&
              (page ? (
                <PagesPlugin
                  key={page}
                  id={page}
                  state={state}
                  set={set}
                  savedAt={savedAt}
                />
              ) : (
                <PagesOverview
                  state={state}
                  set={set}
                  savedAt={savedAt}
                  openPlugin={setPage}
                />
              ))}
            {option === "readout" && (
              <Readout state={state} set={set} savedAt={savedAt} />
            )}
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
