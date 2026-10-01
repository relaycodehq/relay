import { useState } from "react";
import { Check, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { setMode, setThemeChoice } from "../../lib/appearance";
import {
  DEFAULT_CONTRAST,
  isCustomized,
  clearedColors,
  normalizeHex,
  resolvePalette,
  themesFor,
  type AppearanceMode,
  type Palette as ThemePalette,
  type ResolvedAppearance,
  type ThemeChoice,
  type ThemeKind,
} from "../../lib/themes";
import { ThemeCodePreview } from "../ThemeCodePreview";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  SettingsSelect,
} from "../SettingsCard";

/** The colour modes, each pictured in its look, over a sample of code. */
export function ThemeModes({
  mode,
  looks,
  preview,
}: {
  mode: AppearanceMode;
  looks: Record<ThemeKind, ResolvedAppearance>;
  /** Whose code colours the sample shows. */
  preview: ThemeKind;
}) {
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
  return (
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
      <ThemeCodePreview look={looks[preview]} />
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

export const kindLabels: Record<ThemeKind, string> = {
  light: "Light",
  dark: "Dark",
};

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
  return (
    <SettingsSelect
      field="theme-select"
      label={`${kindLabels[kind]} theme`}
      value={look.theme.id}
      icon={<ThemeDot palette={look.palette} accent={look.accent} />}
      options={themesFor(kind).map((theme) => ({
        value: theme.id,
        label: theme.name,
        icon: <ThemeDot palette={theme[kind]!} />,
      }))}
      onChange={onChange}
    />
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
export function ThemeChoiceCard({
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
              onChange={(e) => change({ accent: e.target.value })}
            />
          </label>
        </div>
      </SettingsRow>
      <SettingsRow label="Background">
        <ColorField
          label={`${label} background`}
          value={palette.surface}
          onChange={(color) =>
            change({ background: color === base.surface ? undefined : color })
          }
        />
      </SettingsRow>
      <SettingsRow label="Foreground">
        <ColorField
          label={`${label} foreground`}
          value={palette.text}
          onChange={(color) =>
            change({ foreground: color === base.text ? undefined : color })
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
            change({
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
