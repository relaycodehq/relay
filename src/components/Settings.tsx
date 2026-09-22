import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Info,
  Keyboard,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Palette,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { Account } from "../../shared/types";
import { aiSettingsSchema, type AISettings } from "../../shared/settings";
import { api } from "../lib/api";
import { useAISettings } from "../lib/useAISettings";
import { setAppearance, useAppearance } from "../lib/appearance";
import {
  resolvePalette,
  themes,
  type AppearanceMode,
  type Theme,
} from "../lib/themes";
import { relayIconSvg, svgDataUrl } from "../lib/relay-icon";
import { Avatar, ErrorBox, IconButton } from "./ui";
import { ModelField } from "./ModelField";
import { RelayMark } from "./RelayMark";
import { RoomHostingSettings } from "./RoomHostingSettings";
import "./settings.css";

export type SettingsCategory = CategoryId;
type CategoryId =
  "appearance" | "account" | "models" | "rooms" | "shortcuts" | "about";

const categories: {
  id: CategoryId;
  label: string;
  description: string;
  icon: typeof Palette;
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, colour mode, accent and app icon.",
    icon: Palette,
  },
  {
    id: "account",
    label: "Account",
    description: "Your Gitea connection and credential storage.",
    icon: UserRound,
  },
  {
    id: "models",
    label: "AI models",
    description: "Codex models used for grouping and line questions.",
    icon: Sparkles,
  },
  {
    id: "rooms",
    label: "Shared rooms",
    description: "Host rooms for shared conversations.",
    icon: Users,
  },
  {
    id: "shortcuts",
    label: "Keyboard shortcuts",
    description: "Everything you can do from the keyboard.",
    icon: Keyboard,
  },
  {
    id: "about",
    label: "About",
    description: "Version and credits.",
    icon: Info,
  },
];

const shortcuts: [string, string][] = [
  ["Open settings", "⌘ / Ctrl ,"],
  ["View activity", "⌥⌘U"],
  ["Search pull requests", "⌘ / Ctrl F"],
  ["Open PR URL", "⌘ / Ctrl K"],
  ["Toggle file list", "⌘ / Ctrl B"],
  ["Toggle pull requests", "⌘ / Ctrl Shift B"],
  ["Mark file as read", "V"],
  ["Next / previous file", "J / K"],
];

interface Entry {
  id: string;
  category: CategoryId;
  title: string;
  description?: string;
  keywords?: string;
  /** Block entries put their control under the text instead of beside it. */
  block?: boolean;
  render: () => ReactNode;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const word = query.trim().split(/\s+/)[0];
  const at = word ? text.toLowerCase().indexOf(word.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + word.length)}</mark>
      {text.slice(at + word.length)}
    </>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  const p = theme.dark ?? theme.light!;
  const q = theme.light && theme.dark ? theme.light : undefined;
  const pane = (palette: typeof p, half?: "left" | "right") => (
    <div
      className={`theme-preview-window ${half ?? ""}`}
      style={{ background: palette.surface, borderColor: palette.border }}
    >
      <div
        className="theme-preview-sidebar"
        style={{ background: palette.sidebar }}
      >
        <i style={{ background: palette.text, opacity: 0.55 }} />
        <i style={{ background: palette.selected }} />
        <i style={{ background: palette.muted, opacity: 0.5 }} />
        <i style={{ background: palette.muted, opacity: 0.5 }} />
      </div>
      <div className="theme-preview-body">
        <i style={{ background: palette.text, opacity: 0.8, width: "62%" }} />
        <i style={{ background: palette.muted, opacity: 0.6, width: "84%" }} />
        <i style={{ background: palette.muted, opacity: 0.6, width: "48%" }} />
        <b style={{ background: palette.accent }} />
      </div>
    </div>
  );
  return (
    <div className="theme-preview">
      {q ? (
        <>
          {pane(q, "left")}
          {pane(p, "right")}
        </>
      ) : (
        pane(p)
      )}
    </div>
  );
}

export function Settings({
  account,
  onClose,
  onDisconnect,
  onConnect,
  initialCategory = "appearance",
}: {
  initialCategory?: SettingsCategory;
  account: Account | null;
  onClose: () => void;
  onDisconnect: () => Promise<void>;
  onConnect?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    searchInput.current?.focus();
  }, []);
  const [category, setCategory] = useState<CategoryId>(initialCategory);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>();

  // AI settings keep their explicit save: a model run is expensive to change
  // by accident.
  const settings = useAISettings(),
    qc = useQueryClient();
  const [draft, setDraft] = useState<AISettings>();
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const values = draft ?? settings.data;
  const change = (kind: keyof AISettings, value: AISettings["questions"]) => {
    if (values) {
      setDraft({ ...values, [kind]: value });
      setSaved(false);
    }
  };

  const appearance = useAppearance();
  const activeTheme = appearance.theme;
  const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const iconSrc = useMemo(
    () => svgDataUrl(relayIconSvg(appearance.accent)),
    [appearance.accent],
  );
  const modes: [AppearanceMode, typeof Monitor][] = [
    ["system", Monitor],
    ["light", Sun],
    ["dark", Moon],
  ];
  const modeAvailable = (mode: AppearanceMode) =>
    mode === "system"
      ? !!(activeTheme.light && activeTheme.dark)
      : !!activeTheme[mode];

  const entries: Entry[] = [
    {
      id: "theme",
      category: "appearance",
      title: "Theme",
      description: "Colours for the whole app, including code and diffs.",
      keywords: themes.map((t) => t.name).join(" ") + " color palette skin",
      block: true,
      render: () => (
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {themes.map((theme) => {
            const selected = theme.id === activeTheme.id;
            const palette = resolvePalette(
              theme,
              appearance.value.mode,
              systemDark,
            );
            return (
              <button
                key={theme.id}
                role="radio"
                aria-checked={selected}
                className={`theme-card ${selected ? "selected" : ""}`}
                onClick={() =>
                  setAppearance({
                    theme: theme.id,
                    accent: undefined,
                    // A single-mode theme decides light or dark itself.
                    ...(theme.light && theme.dark ? {} : { mode: "system" }),
                  })
                }
              >
                <ThemePreview theme={theme} />
                <span className="theme-card-label">
                  <RelayMark size={16} accent={palette.accent} />
                  <strong>{theme.name}</strong>
                  {selected && <Check size={13} />}
                </span>
                <small>{theme.description}</small>
              </button>
            );
          })}
        </div>
      ),
    },
    {
      id: "mode",
      category: "appearance",
      title: "Color mode",
      description: modeAvailable("system")
        ? "Follow the system or keep Relay light or dark."
        : `${activeTheme.name} is a ${activeTheme.dark ? "dark" : "light"} theme.`,
      keywords: "appearance light dark system night",
      render: () => (
        <div className="segmented settings-segmented">
          {modes.map(([mode, Icon]) => (
            <button
              key={mode}
              className={
                appearance.value.mode === mode ||
                (!modeAvailable("system") && mode === appearance.palette.kind)
                  ? "active"
                  : ""
              }
              disabled={!modeAvailable(mode)}
              onClick={() => setAppearance({ mode })}
            >
              <Icon size={14} />
              {mode}
            </button>
          ))}
        </div>
      ),
    },
    {
      id: "accent",
      category: "appearance",
      title: "Accent color",
      description:
        "Highlights, selection and the app icon. Pick from the theme or choose your own.",
      keywords: "primary colour highlight tint brand",
      block: true,
      render: () => (
        <div className="accent-picker">
          {[
            ...new Set([appearance.palette.accent, ...activeTheme.swatches]),
          ].map((color) => (
            <button
              key={color}
              className={`accent-swatch ${
                appearance.accent.toLowerCase() === color.toLowerCase()
                  ? "selected"
                  : ""
              }`}
              style={{ background: color }}
              aria-label={`Accent ${color}`}
              title={color}
              onClick={() =>
                setAppearance({
                  accent:
                    color === appearance.palette.accent ? undefined : color,
                })
              }
            />
          ))}
          <label className="accent-custom" title="Custom colour">
            <input
              type="color"
              aria-label="Custom accent color"
              value={appearance.accent}
              onChange={(e) => setAppearance({ accent: e.target.value })}
            />
            <span>Custom</span>
          </label>
          {appearance.value.accent && (
            <button
              className="accent-reset"
              onClick={() => setAppearance({ accent: undefined })}
            >
              <RotateCcw size={12} />
              Theme default
            </button>
          )}
        </div>
      ),
    },
    {
      id: "icon",
      category: "appearance",
      title: "App icon",
      description:
        "The dock icon and the Relay mark follow your accent color automatically.",
      keywords: "dock logo mark brand",
      render: () => (
        <img
          className="settings-app-icon"
          src={iconSrc}
          width={64}
          height={64}
          alt="Relay app icon preview"
        />
      ),
    },
    {
      id: "gitea",
      category: "account",
      title: "Gitea account",
      description: account
        ? account.server
        : "Connect to review pull requests and link projects to their remote.",
      keywords: "sign in login token server connect",
      render: () =>
        account ? (
          <div className="settings-account">
            <Avatar name={account.user.login} />
            <strong>{account.user.login}</strong>
          </div>
        ) : onConnect ? (
          <button className="primary" onClick={onConnect}>
            <LogIn size={14} />
            Connect Gitea
          </button>
        ) : (
          <span className="setting-muted">Not connected</span>
        ),
    },
    ...(account
      ? [
          {
            id: "credentials",
            category: "account" as const,
            title: "Credential storage",
            description: account.persistent
              ? "Your token is encrypted using the operating system’s credential protection."
              : "Your token is kept for this session only because secure credential storage is unavailable.",
            keywords: "keychain token secure encryption",
            render: () => (
              <span className="setting-pill">
                {account.persistent ? "Encrypted" : "Session only"}
              </span>
            ),
          },
          {
            id: "disconnect",
            category: "account" as const,
            title: "Disconnect account",
            description:
              "Local drafts, read marks, and folder links are preserved for this account.",
            keywords: "sign out logout remove",
            render: () => (
              <button
                className="danger subtle"
                onClick={() => void onDisconnect().catch(setError)}
              >
                <LogOut size={14} />
                Disconnect account
              </button>
            ),
          },
        ]
      : []),
    {
      id: "codex-models",
      category: "models",
      title: "Codex models",
      description:
        "Uses your signed-in Codex CLI. Model availability depends on your account.",
      keywords:
        "grouping line questions reasoning effort fast mode model codex ai",
      block: true,
      render: () =>
        values ? (
          <div className="ai-settings">
            <ModelField
              label="Grouping"
              value={values.grouping}
              onChange={(value) => change("grouping", value)}
            />
            <ModelField
              label="Line questions"
              value={values.questions}
              allowDefault
              onChange={(value) => change("questions", value)}
            />
            <p className="field-note">
              Fast mode uses more credits where available. Existing grouping
              checkpoints keep their saved model, reasoning effort and speed;
              these settings apply to new analyses and questions.
            </p>
            <div className="settings-save">
              <button
                className="primary"
                disabled={
                  !draft ||
                  saving ||
                  !aiSettingsSchema.safeParse(values).success
                }
                onClick={async () => {
                  setSaving(true);
                  setError(undefined);
                  try {
                    const next = await api.saveAISettings(values);
                    qc.setQueryData(["ai-settings"], next);
                    setDraft(undefined);
                    setSaved(true);
                  } catch (error) {
                    setError(error);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save AI settings"}
              </button>
              {saved && <span role="status">Settings saved</span>}
            </div>
          </div>
        ) : settings.error ? (
          <ErrorBox
            error={settings.error}
            retry={() => void settings.refetch()}
          />
        ) : (
          <p className="setting-muted">Loading model settings…</p>
        ),
    },
    {
      id: "room-hosting",
      category: "rooms",
      title: "Room hosting",
      keywords: "server share invitation setup key host",
      block: true,
      render: () => <RoomHostingSettings />,
    },
    ...shortcuts.map(([name, keys]) => ({
      id: "shortcut:" + name,
      category: "shortcuts" as const,
      title: name,
      keywords: "keyboard shortcut hotkey " + keys,
      render: () => (
        <span className="settings-keys">
          {keys.split(" / ").map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </span>
      ),
    })),
    {
      id: "version",
      category: "about",
      title: "Relay",
      description: "Version 0.1.0",
      keywords: "version about",
      render: () => <RelayMark size={28} />,
    },
    {
      id: "credits",
      category: "about",
      title: "Credits",
      description: "Built with code from T3 Code.",
      keywords: "license open source t3 code",
      render: () => (
        <a
          href="https://github.com/pingdotgg/t3code"
          onClick={(e) => {
            e.preventDefault();
            void api.openExternal(e.currentTarget.href);
          }}
        >
          T3 Code on GitHub
        </a>
      ),
    },
  ];

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const labelOf = (id: CategoryId) =>
    categories.find((c) => c.id === id)!.label;
  const matches = (entry: Entry) =>
    words.every((word) =>
      [entry.title, entry.description, entry.keywords, labelOf(entry.category)]
        .join(" ")
        .toLowerCase()
        .includes(word),
    );
  const results = words.length ? entries.filter(matches) : [];
  const current = categories.find((c) => c.id === category)!;

  const row = (entry: Entry) => (
    <section
      key={entry.id}
      className={`setting ${entry.block ? "block" : ""}`}
      aria-label={entry.title}
    >
      <div className="setting-text">
        <h4>
          <Highlight text={entry.title} query={query} />
        </h4>
        {entry.description && <p>{entry.description}</p>}
      </div>
      <div className="setting-control">{entry.render()}</div>
    </section>
  );

  return (
    <dialog
      ref={dialog}
      className="settings-screen"
      aria-labelledby={headingId}
      onCancel={(e) => {
        e.preventDefault();
        if (query) setQuery("");
        else onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="settings-nav">
        <h2 id={headingId}>Settings</h2>
        <div className="settings-search">
          <Search size={14} />
          <input
            ref={searchInput}
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </div>
        <nav aria-label="Settings categories">
          {categories.map(({ id, label, icon: Icon }) => {
            const count = words.length
              ? results.filter((e) => e.category === id).length
              : null;
            return (
              <button
                key={id}
                className={!words.length && category === id ? "active" : ""}
                aria-current={!words.length && category === id}
                disabled={count === 0}
                onClick={() => {
                  setQuery("");
                  setCategory(id);
                }}
              >
                <Icon size={15} />
                <span>{label}</span>
                {count != null && count > 0 && <small>{count}</small>}
              </button>
            );
          })}
        </nav>
      </aside>
      <main className="settings-pane">
        <header>
          <div>
            <h3>{words.length ? "Search results" : current.label}</h3>
            <p>
              {words.length
                ? `${results.length} ${results.length === 1 ? "setting" : "settings"} matching “${query.trim()}”`
                : current.description}
            </p>
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </header>
        <div className="settings-content">
          {words.length ? (
            results.length ? (
              categories
                .filter((c) => results.some((e) => e.category === c.id))
                .map((c) => (
                  <div key={c.id} className="settings-group">
                    <h5>{c.label}</h5>
                    {results.filter((e) => e.category === c.id).map(row)}
                  </div>
                ))
            ) : (
              <div className="settings-empty">
                <Search size={20} />
                <p>No settings match “{query.trim()}”.</p>
              </div>
            )
          ) : (
            <div className="settings-group">
              {entries.filter((e) => e.category === category).map(row)}
            </div>
          )}
          {!!error && <ErrorBox error={error} />}
        </div>
      </main>
    </dialog>
  );
}
