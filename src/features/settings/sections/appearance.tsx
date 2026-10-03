import { useMemo, useState } from "react";
import { useAppearance } from "../../../lib/appearance";
import { setCacheHeat, useCacheHeat } from "../../agents/cache-heat";
import { setImagePills, useImagePills } from "../../images/image-pills";
import {
  setSidebarAutoHide,
  useSidebarAutoHide,
} from "../../../lib/sidebar-auto-hide";
import {
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
import { AutoSettleSelect } from "../AutoSettleSettings";
import {
  ComposerToolbarReset,
  ComposerToolbarSettings,
} from "../../composer/ComposerToolbarSettings";
import { ThemeImportSettings } from "../ThemeImportSettings";
import {
  TypographyAdvancedSwitch,
  TypographySettings,
} from "../TypographySettings";
import { kindLabels, ThemeChoiceCard, ThemeModes } from "../ThemeCards";

export function useAppearanceEntries(): SettingEntry[] {
  const appearance = useAppearance();
  const cacheHeat = useCacheHeat();
  const imagePills = useImagePills();
  const sidebarAutoHide = useSidebarAutoHide();
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
      description: "Drag to reorder. Drop below the bar to hide.",
      keywords:
        "composer toolbar order reorder arrange move hide drag controls buttons usage limit quota session weekly ring meter context model effort access mode attach dictation microphone",
      block: true,
      accessory: () => <ComposerToolbarReset />,
      render: () => <ComposerToolbarSettings />,
    },
    {
      id: "image-pills",
      category: "appearance",
      title: "Screenshots in the message",
      description:
        "A pasted or dropped screenshot also goes into the text as a pill, which the agent reads as [Image #1]. Off keeps screenshots above the message only.",
      keywords:
        "screenshot image picture paste drop attach pill chip inline thumbnail composer message",
      render: () => (
        <Switch
          label="Put screenshots in the message"
          checked={imagePills}
          onChange={setImagePills}
        />
      ),
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
            checked={smartNames.value ?? true}
            disabled={!smartNames.loaded || smartNames.saving}
            onChange={(enabled) => smartNames.set(enabled)}
          />
          {smartNames.error && <ErrorBox error={smartNames.error} />}
        </>
      ),
    },
    {
      id: "auto-settle",
      category: "appearance",
      title: "Auto-settle quiet threads",
      description:
        "Move a thread to Settled once it has been quiet this long, or once Relay sees its PR merged. New activity brings it back. A project can set its own under Projects, and one thread can opt out from its right-click menu.",
      keywords:
        "settle settled auto automatic inactive quiet days merged pull request activity sidebar done",
      render: () => <AutoSettleSelect />,
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
  ];
}
