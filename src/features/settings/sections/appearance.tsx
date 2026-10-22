import { useMemo, useState } from "react";
import {
  setGlass,
  setGlassChat,
  setGlassChatFrost,
  setGlassFrost,
  useAppearance,
} from "../../../lib/appearance";
import { mac } from "../../../lib/mod-key";
import { GlassFrostSlider } from "../GlassFrostSlider";
import {
  setActivityBranches,
  useActivityBranches,
} from "../../../lib/activity-branches";
import {
  setSidebarAutoHide,
  useSidebarAutoHide,
} from "../../../lib/sidebar-auto-hide";
import {
  GLASS_CHAT_FROST,
  GLASS_FROST,
  resolveChoice,
  themesFor,
  type ResolvedAppearance,
  type ThemeKind,
} from "../../../lib/themes";
import { relayIconSvg, svgDataUrl } from "../../../lib/relay-icon";
import { api } from "../../../lib/api";
import { useSavedSetting } from "../useSavedSetting";
import type { SettingEntry } from "../settings-search";
import { ErrorBox } from "../../../ui/ui";
import { Switch } from "../../../ui/SettingsCard";
import { ThemeImportSettings } from "../ThemeImportSettings";
import { ChatWidthPreview, ChatWidthSlider } from "../ChatWidthSlider";
import {
  TypographyAdvancedSwitch,
  TypographySettings,
} from "../TypographySettings";
import { kindLabels, ThemeChoiceCard, ThemeModes } from "../ThemeCards";

export function useAppearanceEntries(): SettingEntry[] {
  const appearance = useAppearance();
  const sidebarAutoHide = useSidebarAutoHide();
  const activityBranches = useActivityBranches();
  const smartNames = useSavedSetting(
    {
      queryKey: ["smart-project-names"],
      queryFn: () => api.smartProjectNames(),
      staleTime: Infinity,
    },
    (enabled) => api.saveSmartProjectNames(enabled),
    ["projects"],
  );
  const iconSrc = useMemo(
    () => svgDataUrl(relayIconSvg(appearance.accent)),
    [appearance.accent],
  );
  const { mode } = appearance.value;
  const looks: Record<ThemeKind, ResolvedAppearance> = {
    light: resolveChoice("light", appearance.value.light),
    dark: resolveChoice("dark", appearance.value.dark),
  };
  // Following the system shows both themes; the preview follows the one
  // being edited.
  const kinds: ThemeKind[] = mode === "system" ? ["light", "dark"] : [mode];
  const [editing, setEditing] = useState<ThemeKind>();
  const previewKind =
    editing && kinds.includes(editing) ? editing : appearance.palette.kind;

  return [
    {
      id: "theme",
      category: "appearance",
      section: "Colours",
      title: "Theme",
      description:
        "Follow the system or keep Relay light or dark. Each mode has its own theme.",
      keywords:
        "appearance color colour mode light dark system night code preview syntax diff",
      block: true,
      render: () => (
        <ThemeModes mode={mode} looks={looks} preview={previewKind} />
      ),
    },
    ...kinds.map((kind) => ({
      id: `${kind}-theme`,
      category: "appearance" as const,
      section: "Colours",
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
      id: "vscode-themes",
      category: "appearance",
      section: "Colours",
      title: "VS Code themes",
      description:
        "Install any colour theme from Open VSX. Its themes join the light and dark lists above, code colours included.",
      keywords:
        "vscode vs code open vsx import install extension marketplace cursor noir",
      block: true,
      render: () => <ThemeImportSettings />,
    },
    {
      id: "icon",
      category: "appearance",
      section: "Colours",
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
    ...(mac
      ? [
          {
            id: "glass",
            category: "appearance" as const,
            section: "Window",
            title: "Frosted glass",
            description:
              "The sidebar and header let the desktop behind the window show through, blurred.",
            keywords:
              "frost frosted glass blur translucent transparent vibrancy sidebar header window opacity",
            block: true,
            accessory: () => (
              <Switch
                label="Frosted sidebar and header"
                checked={appearance.value.glass}
                onChange={setGlass}
              />
            ),
            render: () =>
              appearance.value.glass && (
                <GlassFrostSlider
                  label="Frost in the sidebar and header"
                  value={appearance.value.glassFrost}
                  range={GLASS_FROST}
                  onChange={setGlassFrost}
                />
              ),
          },
          {
            id: "glass-chat",
            category: "appearance" as const,
            section: "Window",
            title: "Frosted chat",
            description:
              "The chat lets some of the frost through too. Over a bright or busy desktop it can get harder to read.",
            keywords:
              "frost frosted glass blur translucent transparent vibrancy chat conversation thread background opacity",
            block: true,
            accessory: () => (
              <Switch
                label="Frosted chat"
                checked={appearance.value.glass && appearance.value.glassChat}
                disabled={!appearance.value.glass}
                onChange={setGlassChat}
              />
            ),
            render: () =>
              appearance.value.glass &&
              appearance.value.glassChat && (
                <GlassFrostSlider
                  label="Frost in the chat"
                  value={appearance.value.glassChatFrost}
                  range={GLASS_CHAT_FROST}
                  onChange={setGlassChatFrost}
                />
              ),
          },
        ]
      : []),
    {
      id: "chat-width",
      category: "appearance",
      section: "Window",
      title: "Chat width",
      description:
        "How wide the conversation grows in a wide window. Messages, the composer and the new-thread page follow it.",
      keywords:
        "chat thread conversation column reading width wide narrow monitor screen layout composer messages",
      block: true,
      accessory: () => <ChatWidthSlider />,
      render: () => <ChatWidthPreview />,
    },
    {
      id: "smart-project-names",
      category: "appearance",
      section: "Sidebar",
      title: "Smart project names",
      description:
        "Turn relay-releases into Relay Releases. Off keeps the original folder or repository name. Names you type yourself stay as typed.",
      keywords:
        "projects naming folder repository capitalize separators hyphen underscore original smart",
      render: () => (
        <>
          <Switch
            label="Smart project names"
            checked={smartNames.value ?? true}
            disabled={!smartNames.loaded || smartNames.saving}
            onChange={(enabled) => smartNames.set(enabled)}
          />
          {smartNames.error && <ErrorBox error={smartNames.error} />}
        </>
      ),
    },
    {
      id: "sidebar-auto-hide",
      category: "appearance",
      section: "Sidebar",
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
      id: "activity-branches",
      category: "appearance",
      section: "Sidebar",
      title: "Branches in Activity",
      description:
        "The branch or worktree under each thread's title. Off leaves Activity to titles and times; Projects still shows them.",
      keywords:
        "branch worktree git main commit activity cards thread line hide show version control",
      render: () => (
        <Switch
          label="Show branches in Activity"
          checked={activityBranches}
          onChange={setActivityBranches}
        />
      ),
    },
    {
      id: "typography",
      category: "appearance",
      section: "Text",
      title: "Typography",
      keywords:
        "font family typeface size text code monospace terminal interface prompt zoom smoothing wrap",
      block: true,
      accessory: () => <TypographyAdvancedSwitch />,
      render: () => <TypographySettings />,
    },
  ];
}
