import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDialogContainer } from "../lib/useDialogContainer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Info,
  Keyboard,
  Mic,
  ListTodo,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Puzzle,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  UserRound,
  Users,
  Smartphone,
  MonitorUp,
  X,
} from "lucide-react";
import type { Account } from "../../shared/types";
import { aiSettingsSchema, type AISettings } from "../../shared/settings";
import { api } from "../lib/api";
import { keys } from "../lib/mod-key";
import {
  bindings,
  comboLabel,
  comboWords,
  useShortcutOverrides,
} from "../lib/shortcuts";
import { useQuickKeysLabel } from "../lib/effort-shortcut";
import { command, shortcutGroups, shortcutIds } from "../../shared/shortcuts";
import { ShortcutKeys, ShortcutsResetAll } from "./ShortcutSettings";
import { useAISettings } from "../lib/useAISettings";
import { useUpdates } from "../lib/updates";
import {
  setLiveScope,
  setMode,
  setThemeChoice,
  useAppearance,
} from "../lib/appearance";
import { setCacheHeat, useCacheHeat } from "../lib/cache-heat";
import {
  ComposerToolbarReset,
  ComposerToolbarSettings,
} from "./ComposerToolbarSettings";
import {
  setSidebarAutoHide,
  useSidebarAutoHide,
} from "../lib/sidebar-auto-hide";
import {
  setSendKey,
  steerKeyLabel,
  useSendKey,
  type SendKey,
} from "../lib/send-key";
import {
  DEFAULT_CONTRAST,
  isCustomized,
  clearedColors,
  normalizeHex,
  resolveChoice,
  resolvePalette,
  themesFor,
  type AppearanceMode,
  type Palette as ThemePalette,
  type ResolvedAppearance,
  type ThemeChoice,
  type ThemeKind,
} from "../lib/themes";
import { relayIconSvg, svgDataUrl } from "../lib/relay-icon";
import { Avatar, ErrorBox, IconButton } from "./ui";
import { ModelField } from "./ModelField";
import { ComposerSelect } from "./ComposerSelect";
import { ProviderIcon } from "./ComposerModelPicker";
import { ThemeCodePreview } from "./ThemeCodePreview";
import { ThemeImportSettings } from "./ThemeImportSettings";
import {
  TypographyAdvancedSwitch,
  TypographySettings,
} from "./TypographySettings";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  Switch,
} from "./SettingsCard";
import { UpdateCheck, updateLine } from "./UpdateCheck";
import { Changelog } from "./Changelog";
import { AgentVersionSettings } from "./AgentUpdates";
import { RoomHostingSettings } from "./RoomHostingSettings";
import { GitSettings } from "./GitSettings";
import {
  SourceControlRescan,
  SourceControlSettings,
} from "./SourceControlSettings";
import { PhoneRemoteSettings } from "./PhoneRemoteSettings";
import { ComputersMap, TakeThreadsOver } from "./ComputersSettings";
import {
  DictationMicrophoneSetting,
  DictationModelSetting,
  dictationModelLine,
} from "./DictationSettings";
import { useDictationModel } from "../lib/dictation/session";
import { QuickSwitchSettings } from "./QuickSwitchSettings";
import { PluginCard } from "./plugins/PluginSettings";
import { pluginIds, plugins } from "../../shared/plugins";
import { usePluginEnabled } from "../lib/plugins";
import "./settings.css";
import {
  agentName,
  agentProviders,
  agents,
  type AgentProvider,
} from "../../shared/agents";

export type SettingsCategory = CategoryId;
type CategoryId =
  | "appearance"
  | "account"
  | "models"
  | "integrations"
  | "plugins"
  | "rooms"
  | "phone"
  | "computers"
  | "dictation"
  | "shortcuts"
  | "about";

const categories: {
  id: CategoryId;
  label: string;
  description: string;
  icon: typeof Palette;
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, typography, colour mode, accent and app icon.",
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
    description:
      "The agent new threads start on, and the models for grouping, line questions and commits.",
    icon: Sparkles,
  },
  {
    id: "integrations",
    label: "Integrations",
    description:
      "Git, and the hosts your pull requests, CI and work items come from.",
    icon: ListTodo,
  },
  {
    id: "plugins",
    label: "Plugins",
    description:
      "Extras that ship with Relay and stay out of sight until you turn them on.",
    icon: Puzzle,
  },
  {
    id: "rooms",
    label: "Shared rooms",
    description: "Host rooms for shared conversations.",
    icon: Users,
  },
  {
    id: "phone",
    label: "Phone",
    description: "Follow and answer your threads from the Relay phone app.",
    icon: Smartphone,
  },
  {
    id: "computers",
    label: "Computers",
    description:
      "Hand a thread to another computer running Relay, like a Mac mini at home, and bring it back later.",
    icon: MonitorUp,
  },
  {
    id: "dictation",
    label: "Dictation",
    description: "Speak your messages; words appear as you talk.",
    icon: Mic,
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
    description: "Version, changelog and credits.",
    icon: Info,
  },
];

interface Entry {
  id: string;
  category: CategoryId;
  /** A heading within the category, shared by the entries that follow. */
  section?: string;
  title: string;
  description?: string;
  keywords?: string;
  /** Block entries put their control under the text instead of beside it. */
  block?: boolean;
  /** A small control beside the title, for block entries. */
  accessory?: () => ReactNode;
  /** Entries that draw their whole card, given their (highlighted) title. */
  card?: (title: ReactNode) => ReactNode;
  render?: () => ReactNode;
}

/** Runs of entries under the same heading, in order. */
function sections(entries: Entry[]) {
  const runs: { section?: string; list: Entry[] }[] = [];
  for (const entry of entries) {
    const last = runs.at(-1);
    if (last && last.section === entry.section) last.list.push(entry);
    else runs.push({ section: entry.section, list: [entry] });
  }
  return runs;
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

/** A miniature window per look; two looks share it half and half. */
function ThemePreview({ looks }: { looks: ResolvedAppearance[] }) {
  const pane = ({ palette, accent }: ResolvedAppearance, half?: string) => (
    <div
      key={palette.kind}
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
        <b style={{ background: accent }} />
      </div>
    </div>
  );
  return (
    <div className="theme-preview">
      {looks.length > 1
        ? [pane(looks[0], "left"), pane(looks[1], "right")]
        : pane(looks[0])}
    </div>
  );
}

const kindLabels: Record<ThemeKind, string> = { light: "Light", dark: "Dark" };

/** The theme's background with its accent at the centre. */
function ThemeDot({
  palette,
  accent,
}: {
  palette: ThemePalette;
  accent?: string;
}) {
  return (
    <span
      className="theme-dot"
      style={{
        background: `radial-gradient(circle, ${accent ?? palette.accent} 0 3px, ${palette.surface} 3.5px)`,
      }}
    />
  );
}

function ThemeSelect({
  kind,
  look,
  onChange,
}: {
  kind: ThemeKind;
  look: ResolvedAppearance;
  onChange: (theme: string) => void;
}) {
  // Popups must render inside a modal <dialog> to sit in its top layer.
  const [ref, container] = useDialogContainer();
  return (
    <div ref={ref} className="composer-tools model-field theme-select">
      <ComposerSelect
        label={`${kindLabels[kind]} theme`}
        container={container}
        value={look.theme.id}
        icon={<ThemeDot palette={look.palette} accent={look.accent} />}
        options={themesFor(kind).map((theme) => ({
          value: theme.id,
          label: theme.name,
          icon: <ThemeDot palette={theme[kind]!} />,
        }))}
        onChange={onChange}
      />
    </div>
  );
}

function AgentSelect({
  value,
  onChange,
}: {
  value: AgentProvider;
  onChange: (provider: AgentProvider) => void;
}) {
  // Popups must render inside a modal <dialog> to sit in its top layer.
  const [ref, container] = useDialogContainer();
  return (
    <div ref={ref} className="composer-tools model-field">
      <ComposerSelect<AgentProvider>
        label="Default agent"
        container={container}
        value={value}
        icon={<ProviderIcon provider={value} />}
        options={agentProviders.map((provider) => ({
          value: provider,
          label: agentName(provider),
          icon: <ProviderIcon provider={provider} />,
        }))}
        onChange={onChange}
      />
    </div>
  );
}

/** A colour well beside its hex code; either one edits the colour. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [draft, setDraft] = useState<string>();
  return (
    <div className="color-field">
      <input
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="text"
        aria-label={`${label} hex code`}
        spellCheck={false}
        maxLength={7}
        value={draft ?? value.toUpperCase()}
        onChange={(e) => {
          setDraft(e.target.value);
          const color = normalizeHex(e.target.value);
          if (color && e.target.value.replace("#", "").length === 6)
            onChange(color);
        }}
        onBlur={(e) => {
          const color = normalizeHex(e.target.value);
          if (color) onChange(color);
          setDraft(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </div>
  );
}

/** One colour mode's theme and the few colours you can tune on top of it. */
function ThemeChoiceCard({
  kind,
  choice,
  look,
}: {
  kind: ThemeKind;
  choice: ThemeChoice;
  look: ResolvedAppearance;
}) {
  const { theme, palette, accent } = look;
  const base = resolvePalette(kind, { theme: theme.id });
  const change = (patch: Partial<ThemeChoice>) => setThemeChoice(kind, patch);
  // Wells and the slider fire on every pointer move.
  const drag = (patch: Partial<ThemeChoice>) =>
    setThemeChoice(kind, patch, true);
  const label = kindLabels[kind];
  const contrast = choice.contrast ?? DEFAULT_CONTRAST;
  return (
    <SettingsCard>
      <SettingsRow label="Theme" hint={theme.description}>
        <ThemeSelect
          kind={kind}
          look={look}
          // A new theme brings its own colours; contrast is a preference.
          onChange={(id) => change({ theme: id, ...clearedColors })}
        />
      </SettingsRow>
      <SettingsRow
        label="Accent"
        hint="Highlights, selection and the app icon."
      >
        <div className="accent-picker">
          {[...new Set([base.accent, ...theme.swatches])].map((color) => (
            <button
              key={color}
              className={`accent-swatch ${
                accent.toLowerCase() === color.toLowerCase() ? "selected" : ""
              }`}
              style={{ background: color }}
              aria-label={`${label} accent ${color}`}
              aria-pressed={accent.toLowerCase() === color.toLowerCase()}
              title={color}
              onClick={() =>
                change({ accent: color === base.accent ? undefined : color })
              }
            />
          ))}
          <label className="accent-custom" title="Custom colour">
            <input
              type="color"
              aria-label={`${label} custom accent`}
              value={accent}
              onChange={(e) => drag({ accent: e.target.value })}
            />
          </label>
        </div>
      </SettingsRow>
      <SettingsRow label="Background">
        <ColorField
          label={`${label} background`}
          value={palette.surface}
          onChange={(color) =>
            drag({ background: color === base.surface ? undefined : color })
          }
        />
      </SettingsRow>
      <SettingsRow label="Foreground">
        <ColorField
          label={`${label} foreground`}
          value={palette.text}
          onChange={(color) =>
            drag({ foreground: color === base.text ? undefined : color })
          }
        />
      </SettingsRow>
      <SettingsRow
        label="Contrast"
        hint="How far sidebars, borders and secondary text stand apart."
      >
        <input
          type="range"
          min={0}
          max={100}
          aria-label={`${label} contrast`}
          value={contrast}
          onChange={(e) => {
            const value = Number(e.target.value);
            drag({
              contrast: value === DEFAULT_CONTRAST ? undefined : value,
            });
          }}
        />
        <span className="settings-row-value">{contrast}</span>
      </SettingsRow>
      <SettingsFooter note="Code keeps the theme’s own syntax colours.">
        <button
          disabled={!isCustomized(choice)}
          onClick={() => change({ ...clearedColors, contrast: undefined })}
        >
          <RotateCcw size={12} />
          Reset to {theme.name}
        </button>
      </SettingsFooter>
    </SettingsCard>
  );
}

export function Settings({
  account,
  onClose,
  onDisconnect,
  onConnect,
  onOpenChat,
  initialCategory = "appearance",
}: {
  initialCategory?: SettingsCategory;
  account: Account | null;
  onClose: () => void;
  onDisconnect: () => Promise<void>;
  onConnect?: () => void;
  /** Opens a thread, e.g. one listed under Computers. */
  onOpenChat?: (projectId: string, chatId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  useEffect(() => {
    dialog.current?.showModal();
    searchInput.current?.focus();
    // Dragged colours restyle this dialog first; the page follows later.
    setLiveScope(dialog.current);
    return () => setLiveScope(null);
  }, []);
  const [category, setCategory] = useState<CategoryId>(initialCategory);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<unknown>();

  // AI settings keep their explicit save: a model run is expensive to change
  // by accident.
  const settings = useAISettings(),
    qc = useQueryClient();
  const smartProjectNames = useQuery({
    queryKey: ["smart-project-names"],
    queryFn: () => api.smartProjectNames(),
    staleTime: Infinity,
  });
  const saveSmartProjectNames = useMutation({
    mutationFn: (enabled: boolean) => api.saveSmartProjectNames(enabled),
    onSuccess: async (enabled) => {
      qc.setQueryData(["smart-project-names"], enabled);
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const [draft, setDraft] = useState<AISettings>();
  const [saving, setSaving] = useState(false),
    [saved, setSaved] = useState(false);
  const values = draft ?? settings.data;
  const change = (
    kind: "grouping" | "questions" | "split" | "commitMessage" | "timesheet",
    value: AISettings["questions"],
    provider: AgentProvider,
  ) => {
    if (values) {
      setDraft({ ...values, [kind]: value, [`${kind}Provider`]: provider });
      setSaved(false);
    }
  };

  // Releases stamp their own version at build time; the updater knows it.
  const updates = useUpdates();
  const dictationModel = useDictationModel();
  const appearance = useAppearance();
  const cacheHeat = useCacheHeat();
  const sidebarAutoHide = useSidebarAutoHide();
  const sendKey = useSendKey();
  // Plugins that are off leave no trace in the rest of Settings.
  const timesheets = usePluginEnabled("clockify");
  // Search finds shortcuts by their current keys.
  useShortcutOverrides();
  const quickKeys = useQuickKeysLabel();
  const iconSrc = useMemo(
    () => svgDataUrl(relayIconSvg(appearance.accent)),
    [appearance.accent],
  );
  const { mode } = appearance.value;
  const looks: Record<ThemeKind, ResolvedAppearance> = {
    light: resolveChoice("light", appearance.value.light),
    dark: resolveChoice("dark", appearance.value.dark),
  };
  const modes: [
    AppearanceMode,
    string,
    typeof Monitor,
    ResolvedAppearance[],
  ][] = [
    ["system", "System", Monitor, [looks.light, looks.dark]],
    ["light", "Light", Sun, [looks.light]],
    ["dark", "Dark", Moon, [looks.dark]],
  ];
  // Following the system shows both themes; the preview follows the one
  // being edited.
  const kinds: ThemeKind[] = mode === "system" ? ["light", "dark"] : [mode];
  const [editing, setEditing] = useState<ThemeKind>();
  const previewKind =
    editing && kinds.includes(editing) ? editing : appearance.palette.kind;

  const sendKeyEntry: Entry = {
    id: "send-key",
    category: "shortcuts",
    section: "Composer",
    title: "Send messages with",
    description:
      {
        enter: "Enter sends the message. Shift+Enter adds a new line.",
        "shift-enter": "Shift+Enter sends the message. Enter adds a new line.",
        "mod-enter": `${keys("⌘", "Ctrl+")}Enter sends the message. Enter adds a new line.`,
      }[sendKey] +
      ` While an agent is working, this queues the message and ${steerKeyLabel(sendKey)} steers the current answer instead.`,
    keywords:
      "enter return send submit message newline composer chat queue steer",
    render: () => (
      <div className="segmented settings-segmented">
        {(
          [
            ["enter", "Enter"],
            ["shift-enter", "Shift Enter"],
            ["mod-enter", `${keys("⌘", "Ctrl ")}Enter`],
          ] as [SendKey, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={sendKey === value ? "active" : ""}
            aria-pressed={sendKey === value}
            onClick={() => setSendKey(value)}
          >
            {label}
          </button>
        ))}
      </div>
    ),
  };
  const entries: Entry[] = [
    {
      id: "theme",
      category: "appearance",
      title: "Theme",
      description:
        "Follow the system or keep Relay light or dark. Each mode has its own theme.",
      keywords:
        "appearance color colour mode light dark system night code preview syntax diff",
      block: true,
      render: () => (
        <>
          <div className="mode-grid" role="radiogroup" aria-label="Color mode">
            {modes.map(([value, label, Icon, previews]) => (
              <button
                key={value}
                role="radio"
                aria-checked={mode === value}
                className={`theme-card ${mode === value ? "selected" : ""}`}
                onClick={() => setMode(value)}
              >
                <ThemePreview looks={previews} />
                <span className="theme-card-label">
                  <Icon size={14} />
                  <strong>{label}</strong>
                  {mode === value && <Check size={13} />}
                </span>
              </button>
            ))}
          </div>
          <ThemeCodePreview look={looks[previewKind]} />
        </>
      ),
    },
    ...kinds.map((kind) => ({
      id: `${kind}-theme`,
      category: "appearance" as const,
      title: `${kindLabels[kind]} theme`,
      description:
        mode === "system"
          ? `Used while your system is in ${kind} mode.`
          : undefined,
      keywords:
        themesFor(kind)
          .map((t) => t.name)
          .join(" ") +
        " accent background foreground contrast color colour palette skin",
      block: true,
      render: () => (
        <div onFocusCapture={() => setEditing(kind)}>
          <ThemeChoiceCard
            kind={kind}
            choice={appearance.value[kind]}
            look={looks[kind]}
          />
        </div>
      ),
    })),
    {
      id: "typography",
      category: "appearance",
      title: "Typography",
      keywords:
        "font family typeface size text code monospace terminal interface prompt zoom smoothing wrap",
      block: true,
      accessory: () => <TypographyAdvancedSwitch />,
      render: () => <TypographySettings />,
    },
    {
      id: "vscode-themes",
      category: "appearance",
      title: "VS Code themes",
      description:
        "Install any colour theme from Open VSX. Its themes join the light and dark lists above, code colours included.",
      keywords:
        "vscode vs code open vsx import install extension marketplace cursor noir",
      block: true,
      render: () => <ThemeImportSettings />,
    },
    {
      id: "composer-toolbar",
      category: "appearance",
      title: "Composer toolbar",
      description:
        "Drag to reorder. Drop below the bar to hide.",
      keywords:
        "composer toolbar order reorder arrange move hide drag controls buttons usage limit quota session weekly ring meter context model effort access mode attach dictation microphone",
      block: true,
      accessory: () => <ComposerToolbarReset />,
      render: () => <ComposerToolbarSettings />,
    },
    {
      id: "cache-heat",
      category: "appearance",
      title: "Prompt cache fire and ice",
      description:
        "Flames on the context meter while the prompt cache is fresh, an ice cube once it has expired. Right-click the ring to put it out for one chat.",
      keywords: "prompt cache fire flame ice cold fresh context meter ring",
      render: () => (
        <Switch
          label="Show prompt cache fire and ice"
          checked={cacheHeat}
          onChange={setCacheHeat}
        />
      ),
    },
    {
      id: "smart-project-names",
      category: "appearance",
      title: "Smart project names",
      description:
        "Turn relay-releases into Relay Releases. Off keeps the original folder or repository name. Names you type yourself stay as typed.",
      keywords:
        "projects naming folder repository capitalize separators hyphen underscore original smart",
      render: () => (
        <>
          <Switch
            label="Smart project names"
            checked={
              (saveSmartProjectNames.isPending
                ? saveSmartProjectNames.variables
                : smartProjectNames.data) ?? true
            }
            disabled={
              smartProjectNames.data === undefined ||
              saveSmartProjectNames.isPending
            }
            onChange={(enabled) => saveSmartProjectNames.mutate(enabled)}
          />
          {(smartProjectNames.isError || saveSmartProjectNames.isError) && (
            <ErrorBox
              error={smartProjectNames.error ?? saveSmartProjectNames.error}
            />
          )}
        </>
      ),
    },
    {
      id: "sidebar-auto-hide",
      category: "appearance",
      title: "Make room for side panes",
      description:
        "Hide the projects sidebar while Changes, Files or History is open, and bring it back when they close.",
      keywords: "sidebar projects hide collapse changes files history pane",
      render: () => (
        <Switch
          label="Hide the sidebar while side panes are open"
          checked={sidebarAutoHide}
          onChange={setSidebarAutoHide}
        />
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
      title: "Agents",
      description: `Uses your signed-in ${agentProviders.map((p) => agents[p].cli).join(", ")}. Model availability depends on your account.`,
      keywords:
        "default agent new thread grouping line questions commit split message reasoning effort fast mode model codex claude opencode cursor ai",
      block: true,
      render: () =>
        values ? (
          <SettingsCard>
            <SettingsRow
              label="Default agent"
              hint="Where a new thread starts in a project you haven't picked an agent for. A pick stays with its project."
            >
              <AgentSelect
                value={values.threadProvider}
                onChange={(threadProvider) => {
                  setDraft({ ...values, threadProvider });
                  setSaved(false);
                }}
              />
            </SettingsRow>
            <SettingsRow
              label="Grouping"
              hint="Splits a pull request into reviewable steps."
            >
              <ModelField
                label="Grouping"
                value={values.grouping}
                provider={values.groupingProvider}
                onChange={(value, provider) =>
                  change("grouping", value, provider)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Line questions"
              hint="Answers what you ask about a line of code."
            >
              <ModelField
                label="Line questions"
                value={values.questions}
                provider={values.questionsProvider}
                allowDefault
                onChange={(value, provider) =>
                  change("questions", value, provider)
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Commit splits"
              hint="Splits your local changes into logical commits you review before they're made."
            >
              <ModelField
                label="Commit splits"
                value={values.split}
                provider={values.splitProvider}
                providers={agentProviders}
                allowDefault
                onChange={(value, provider) => change("split", value, provider)}
              />
            </SettingsRow>
            <SettingsRow
              label="Commit messages"
              hint="Drafts the message in the Commit and Commit & push sheets."
            >
              <ModelField
                label="Commit messages"
                value={values.commitMessage}
                provider={values.commitMessageProvider}
                providers={agentProviders}
                allowDefault
                onChange={(value, provider) =>
                  change("commitMessage", value, provider)
                }
              />
            </SettingsRow>
            {timesheets && (
              <SettingsRow
                label="Timesheets"
                hint="Describes your day's entries for the Clockify plugin."
              >
                <ModelField
                  label="Timesheets"
                  value={values.timesheet}
                  provider={values.timesheetProvider}
                  providers={agentProviders}
                  allowDefault
                  onChange={(value, provider) =>
                    change("timesheet", value, provider)
                  }
                />
              </SettingsRow>
            )}
            <SettingsFooter
              note={
                saved ? (
                  <span role="status">Settings saved</span>
                ) : (
                  "Fast mode uses more credits where available. Existing grouping checkpoints keep their saved model, reasoning effort and speed."
                )
              }
            >
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
            </SettingsFooter>
          </SettingsCard>
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
      id: "quick-switch",
      category: "models",
      title: "Quick switch",
      description: `Presets of agent, model and effort that ${quickKeys || "the quick-switch keys"} step through in the composer.`,
      keywords:
        "quick switch presets favourite favorite model agent effort keyboard shortcut arrows drum style",
      block: true,
      render: () => <QuickSwitchSettings />,
    },
    {
      id: "agent-versions",
      category: "models",
      title: "Installed agents",
      description:
        "Relay runs the agent CLIs installed on this computer, and Cursor's SDK, which it downloads itself, and tells you when a newer release is out.",
      keywords:
        "version update upgrade install cli codex claude code opencode cursor sdk npm homebrew bun",
      block: true,
      render: () => <AgentVersionSettings />,
    },
    {
      id: "git",
      category: "integrations",
      title: "Git",
      description:
        "Relay finds it by itself, the one your terminal runs first. Link another here.",
      keywords: "git executable path program install branch folder exe",
      block: true,
      render: () => <GitSettings />,
    },
    {
      id: "source-control",
      category: "integrations",
      title: "Source control",
      description:
        "CI and pull requests from GitHub and Gitea. Relay uses the CLIs and accounts on this computer.",
      keywords:
        "github gitea forgejo gh tea cli ci actions pull request host sign in login link path token",
      block: true,
      accessory: () => <SourceControlRescan />,
      render: () => <SourceControlSettings onConnect={onConnect} />,
    },
    ...pluginIds.map((id): Entry => ({
      id: `plugin-${id}`,
      category: "plugins",
      title: plugins[id].title,
      description: plugins[id].description,
      keywords: `plugin extension ${plugins[id].keywords}`,
      card: (title) => <PluginCard id={id} title={title} />,
    })),
    {
      id: "room-hosting",
      category: "rooms",
      title: "Room hosting",
      keywords: "server share invitation setup key host",
      block: true,
      render: () => <RoomHostingSettings />,
    },
    {
      id: "phone-remote",
      category: "phone",
      title: "Phone access",
      description:
        "Pair a phone to see what your agents are doing, answer their questions and send messages while you're away from the desk.",
      keywords: "phone mobile android remote qr pair tailscale",
      block: true,
      render: () => <PhoneRemoteSettings />,
    },
    {
      id: "computers-map",
      category: "computers",
      title: "Your computers",
      description:
        "Pick one to see the threads on it. Hand a thread over from its header; its agent writes a note, the worktree is committed and it carries on there.",
      keywords:
        "computer handoff hand off mac mini server vps remote pair tailscale continue away bring back",
      block: true,
      render: () => (
        <ComputersMap
          onOpenChat={
            onOpenChat &&
            ((projectId, chatId) => {
              onClose();
              onOpenChat(projectId, chatId);
            })
          }
        />
      ),
    },
    {
      id: "computers-accept",
      category: "computers",
      section: "Take threads over",
      title: "On the computer that stays on",
      description:
        "Turn this on on the Mac mini or server, then pair the other computer with the link it shows.",
      keywords:
        "computer handoff accept receive mac mini server pairing link tailscale",
      block: true,
      render: () => <TakeThreadsOver />,
    },
    {
      id: "dictation-model",
      category: "dictation",
      title: "Speech model",
      description: dictationModelLine(dictationModel),
      keywords:
        "dictation voice speech microphone parakeet download model transcribe",
      render: () => <DictationModelSetting />,
    },
    {
      id: "dictation-shortcut",
      category: "dictation",
      title: "Shortcut",
      description: command("dictate").description,
      keywords: "dictation voice speech keyboard shortcut hotkey push to talk",
      render: () => <ShortcutKeys id="dictate" />,
    },
    {
      id: "dictation-microphone",
      category: "dictation",
      title: "Microphone",
      keywords: "dictation voice input device audio mic",
      render: () => <DictationMicrophoneSetting />,
    },
    {
      id: "shortcuts-intro",
      category: "shortcuts",
      title: "Change a shortcut",
      description:
        "Click one and press the keys you want; Esc cancels and ⌫ removes it. They're kept on this computer.",
      keywords: "keyboard shortcut hotkey keybinding rebind customize reset",
      render: () => <ShortcutsResetAll />,
    },
    ...shortcutGroups.flatMap((group): Entry[] => [
      ...(group === "Composer" ? [sendKeyEntry] : []),
      ...shortcutIds
        .filter((id) => command(id).group === group)
        .map((id) => ({
          id: "shortcut:" + id,
          category: "shortcuts" as const,
          section: group,
          title: command(id).title,
          description: command(id).description,
          keywords: [
            "keyboard shortcut hotkey keybinding",
            command(id).keywords,
            ...bindings(id).map(
              (c) => comboLabel(c, command(id).digits) + " " + comboWords(c),
            ),
          ].join(" "),
          render: () => <ShortcutKeys id={id} />,
        })),
    ]),
    {
      id: "version",
      category: "about",
      title: "Relay",
      description: updateLine(updates),
      keywords: "version about check for updates upgrade",
      render: () => <UpdateCheck />,
    },
    {
      id: "changelog",
      category: "about",
      title: "Changelog",
      description: "What changed in each version.",
      keywords: "changelog release notes what's new version history",
      block: true,
      render: () => <Changelog />,
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

  const row = (entry: Entry) => {
    if (entry.card)
      return (
        <section
          key={entry.id}
          className="setting card"
          aria-label={entry.title}
        >
          {entry.card(<Highlight text={entry.title} query={query} />)}
        </section>
      );
    const text = (
      <div className="setting-text">
        <h4>
          <Highlight text={entry.title} query={query} />
        </h4>
        {entry.description && <p>{entry.description}</p>}
      </div>
    );
    return (
      <section
        key={entry.id}
        className={`setting ${entry.block ? "block" : ""}`}
        aria-label={entry.title}
      >
        {entry.accessory ? (
          <div className="setting-head">
            {text}
            {entry.accessory()}
          </div>
        ) : (
          text
        )}
        <div className="setting-control">{entry.render?.()}</div>
      </section>
    );
  };

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
            sections(entries.filter((e) => e.category === category)).map(
              ({ section, list }, i) => (
                <div key={section ?? i} className="settings-group">
                  {section && <h5>{section}</h5>}
                  {list.map(row)}
                </div>
              ),
            )
          )}
          {!!error && <ErrorBox error={error} />}
        </div>
      </main>
    </dialog>
  );
}
