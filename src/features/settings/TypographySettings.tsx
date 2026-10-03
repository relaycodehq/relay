import type { ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useAppearance } from "../../lib/appearance";
import { terminalTheme } from "../terminal/terminal-theme";
import {
  DEFAULT_MONO,
  DEFAULT_SANS,
  defaultTypography,
  FOLLOW_INTERFACE,
  fontStack,
  setTypography,
  sizes,
  useTypography,
  type Typography,
} from "../../lib/typography";
import { FontPicker } from "./FontPicker";
import {
  SettingsCard,
  SettingsFooter,
  SettingsRow,
  SettingsSelect,
  Switch,
} from "../../ui/SettingsCard";
import { ThemeCodePreview } from "./ThemeCodePreview";
import { mac } from "../../lib/mod-key";

function SizeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (size: number) => void;
}) {
  return (
    <SettingsSelect
      field="size-select"
      label={label}
      value={String(value)}
      options={options.map((size) => ({
        value: String(size),
        label: size === FOLLOW_INTERFACE ? "Match interface" : `${size} px`,
      }))}
      onChange={(size) => onChange(Number(size))}
    />
  );
}

/** A surface's family and size side by side, with a sample of it below. */
function FontRow({
  label,
  hint,
  picker,
  size,
  sizeOptions,
  onSize,
  children,
}: {
  label: string;
  hint: string;
  picker: ReactNode;
  size: number;
  sizeOptions: number[];
  onSize: (size: number) => void;
  children?: ReactNode;
}) {
  return (
    <SettingsRow label={label} hint={hint} below={children}>
      {picker}
      <SizeSelect
        label={`${label} size`}
        value={size}
        options={sizeOptions}
        onChange={onSize}
      />
    </SettingsRow>
  );
}

function PromptSample() {
  return (
    <div className="composer-prompt-input typography-prompt" aria-hidden>
      Use{" "}
      <span className="composer-skill-chip">
        <span className="composer-skill-icon">◇</span>
        <span>Frontend Design</span>
      </span>{" "}
      to fix the flaky test in @tests/unit/settings.test.ts and align the header
      with @src/components/Settings.tsx before shipping.
    </div>
  );
}

function TerminalSample() {
  const { palette, accent } = useAppearance();
  const ansi = terminalTheme(palette, accent);
  const c = (color: string | undefined, text: string, bold?: boolean) => (
    <span style={{ color, fontWeight: bold ? 600 : undefined }}>{text}</span>
  );
  const prompt = (
    <>
      {c(ansi.green, "→ ")}
      {c(ansi.cyan, "relay ", true)}
      {c(ansi.blue, "git:(")}
      {c(ansi.red, "main")}
      {c(ansi.blue, ") ")}
      {c(ansi.yellow, "✗ ")}
    </>
  );
  return (
    <pre
      className="typography-terminal"
      aria-hidden
      style={{ background: ansi.background, color: ansi.foreground }}
    >
      {prompt}npm run dev{"\n\n"}
      {"  "}
      {c(ansi.green, "VITE v8.3.0", true)} ready in{" "}
      {c(undefined, "412 ms", true)}
      {"\n\n  ➜  Local:   "}
      {c(ansi.cyan, "http://127.0.0.1:5177/")}
      {"\n\n  "}
      {c(ansi.green, "✓ 212 passed")}
      {"   "}
      {c(ansi.yellow, "△ 2 warnings")}
      {"   "}
      {c(ansi.red, "✗ 0 failed")}
      {"\n\n"}
      {prompt}
      <span
        className="typography-terminal-cursor"
        style={{ background: ansi.cursor }}
      />
    </pre>
  );
}

export function TypographySettings() {
  const t = useTypography();
  const look = useAppearance();
  const changed = (Object.keys(defaultTypography) as (keyof Typography)[])
    .filter((key) => key !== "advanced")
    .some((key) => t[key] !== defaultTypography[key]);
  // Without the advanced rows the code font is the terminal's too.
  const setCode = (patch: Partial<Typography>) =>
    setTypography(
      t.advanced
        ? patch
        : {
            ...patch,
            ...(patch.mono !== undefined && { terminal: "" }),
            ...(patch.codeSize && { terminalSize: patch.codeSize }),
          },
    );
  return (
    <SettingsCard className="typography-card">
      <FontRow
        label="Interface font"
        hint={
          t.advanced
            ? "Everything outside the prompt, code and the terminal."
            : "Everything outside code and the terminal."
        }
        picker={
          <FontPicker
            label="Interface font"
            value={t.sans}
            defaultLabel="System"
            fallback={DEFAULT_SANS}
            onChange={(sans) => setTypography({ sans })}
          />
        }
        size={t.interfaceSize}
        sizeOptions={sizes.interfaceSize}
        onSize={(interfaceSize) => setTypography({ interfaceSize })}
      />
      {t.advanced && (
        <FontRow
          label="Prompt font"
          hint="Only the box you write prompts in. Mono works well here."
          picker={
            <FontPicker
              label="Prompt font"
              value={t.prompt}
              defaultLabel="Interface font"
              fallback={fontStack(t.sans, DEFAULT_SANS)}
              onChange={(prompt) => setTypography({ prompt })}
            />
          }
          size={t.promptSize}
          sizeOptions={sizes.promptSize}
          onSize={(promptSize) => setTypography({ promptSize })}
        >
          <PromptSample />
        </FontRow>
      )}
      <FontRow
        label="Code font"
        hint={
          t.advanced
            ? "Code blocks, diffs and file views."
            : "Code blocks, diffs, file views and the terminal."
        }
        picker={
          <FontPicker
            label="Code font"
            value={t.mono}
            defaultLabel="System mono"
            fallback={DEFAULT_MONO}
            mono
            onChange={(mono) => setCode({ mono })}
          />
        }
        size={t.codeSize}
        sizeOptions={sizes.codeSize}
        onSize={(codeSize) => setCode({ codeSize })}
      >
        <ThemeCodePreview look={look} />
      </FontRow>
      {t.advanced && (
        <FontRow
          label="Terminal font"
          hint="Terminal output, apart from code blocks and diffs."
          picker={
            <FontPicker
              label="Terminal font"
              value={t.terminal}
              defaultLabel="Code font"
              fallback={fontStack(t.mono, DEFAULT_MONO)}
              mono
              onChange={(terminal) => setTypography({ terminal })}
            />
          }
          size={t.terminalSize}
          sizeOptions={sizes.terminalSize}
          onSize={(terminalSize) => setTypography({ terminalSize })}
        >
          <TerminalSample />
        </FontRow>
      )}
      {t.advanced && mac && (
        <SettingsRow
          label="Font smoothing"
          hint="Thinner grayscale text smoothing instead of the macOS default."
        >
          <Switch
            label="Font smoothing"
            checked={t.smoothing}
            onChange={(smoothing) => setTypography({ smoothing })}
          />
        </SettingsRow>
      )}
      {t.advanced && (
        <SettingsRow
          label="Word wrap"
          hint="Wrap long lines in chat code blocks, diffs and file views."
        >
          <Switch
            label="Word wrap"
            checked={t.wrap}
            onChange={(wrap) => setTypography({ wrap })}
          />
        </SettingsRow>
      )}
      <SettingsFooter note="Fonts come from this computer. Zooming in and out still scales everything.">
        <button
          disabled={!changed}
          onClick={() =>
            setTypography({ ...defaultTypography, advanced: t.advanced })
          }
        >
          <RotateCcw size={12} />
          Reset
        </button>
      </SettingsFooter>
    </SettingsCard>
  );
}

/** The switch in the section's header that shows every surface's row. */
export function TypographyAdvancedSwitch() {
  const { advanced } = useTypography();
  return (
    <label className="typography-advanced">
      Advanced
      <Switch
        label="Advanced typography"
        checked={advanced}
        onChange={(next) => setTypography({ advanced: next })}
      />
    </label>
  );
}
