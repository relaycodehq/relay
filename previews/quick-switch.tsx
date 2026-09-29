// Quick switch: model presets from Settings that ⌘⌥←→ steps through in the composer.
// Open http://127.0.0.1:5177/previews/quick-switch.html
// (?view=track|list|drum|dock|tab|settings&at=2, &closed to start hidden)
import "./desktop-stub";
import {
  StrictMode,
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
} from "react";
import { createRoot } from "react-dom/client";
import { ChevronLeft, ChevronRight, GripVertical, Plus, X, Zap } from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/settings.css";
import "../src/components/composer-model-picker.css";
import "./quick-switch.css";
import { initAppearance } from "../src/lib/appearance";
import { ProviderIcon } from "../src/components/ComposerModelPicker";
import { ComposerSelect } from "../src/components/ComposerSelect";
import { SettingsCard, SettingsRow, Switch } from "../src/components/SettingsCard";
import { agentName, agentProviders, type AgentProvider } from "../shared/agents";
import { effortLabels } from "../shared/settings";
import {
  catalog,
  Current,
  effortName,
  groupsOf,
  keysLabel,
  modelName,
  samplePresets,
  type HudProps,
  type Preset,
} from "./quick-switch-common";
import { DockHud, DrumHud, TabHud } from "./quick-switch-more";

initAppearance();

/** A: the usage meter's thin track with the Settings switch's knob. */
function TrackHud({ presets, index, dir, onPick }: HudProps) {
  const n = presets.length;
  const at = presets[index];
  const place = (i: number) => (n > 1 ? i / (n - 1) : 0.5);
  return (
    <div className="composer-select-popup qs-popup" data-provider={at.provider}>
      <div className="composer-menu-label">
        Quick switch
        <kbd>{keysLabel}</kbd>
      </div>
      <div className="qs-track-body">
        <Current preset={at} dir={dir} />
        <div className="qs-track" style={{ "--frac": place(index) } as CSSProperties}>
          <span className="qs-fill" />
          {presets.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className="qs-stop"
              data-passed={i < index || undefined}
              aria-label={`${modelName(p)}, ${effortName(p)}`}
              aria-pressed={i === index}
              style={{ "--at": place(i) } as CSSProperties}
              onClick={() => onPick(i)}
            />
          ))}
          <span className="qs-knob" aria-hidden />
        </div>
        <div className="qs-groups">
          {groupsOf(presets).map((g) => (
            <span
              key={g.from}
              className="qs-group"
              data-on={(index >= g.from && index <= g.to) || undefined}
              data-edge={g.to === 0 ? "start" : g.from === n - 1 ? "end" : undefined}
              style={{ "--mid": (place(g.from) + place(g.to)) / 2 } as CSSProperties}
            >
              {agentName(g.provider)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** B: the model menu's rows, with the selection sliding between them. */
function ListHud({ presets, index, onPick }: HudProps) {
  const at = presets[index];
  return (
    <div className="composer-select-popup qs-popup qs-list" data-provider={at.provider}>
      <div className="composer-menu-label">
        Quick switch
        <kbd>{keysLabel}</kbd>
      </div>
      <div
        className="qs-rows"
        role="listbox"
        aria-label="Presets"
        data-qs-rows
        style={{ "--i": index } as CSSProperties}
      >
        <span className="qs-row-highlight" aria-hidden />
        {presets.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="option"
            aria-selected={i === index}
            className="qs-row"
            onClick={() => onPick(i)}
          >
            <ProviderIcon provider={p.provider} />
            <span className="qs-row-model">{modelName(p)}</span>
            {p.fast && <Zap size={12} className="qs-fast" aria-label="Fast" />}
            <span className="qs-row-effort">{effortName(p)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const popups = { track: TrackHud, list: ListHud, drum: DrumHud, dock: DockHud };
type Variant = keyof typeof popups | "tab";

function ComposerMock({
  variant,
  presets,
  index,
  dir,
  open,
  onToggle,
  onPick,
}: HudProps & {
  variant: Variant;
  open: boolean;
  onToggle: () => void;
}) {
  const at = presets[index];
  const Popup = variant === "tab" ? undefined : popups[variant];
  return (
    <div className="qs-stage" data-variant={variant}>
      {Popup && (
        <div className="qs-hud-slot" data-open={open || undefined}>
          <Popup presets={presets} index={index} dir={dir} onPick={onPick} />
        </div>
      )}
      <div className="qs-composer-wrap">
        {variant === "tab" && (
          <TabHud presets={presets} index={index} dir={dir} onPick={onPick} open={open} />
        )}
        <div className="project-composer qs-composer" data-provider={at.provider}>
          <div className="qs-draft">Ask about the code, plan a change, or build something…</div>
          <div className="composer-tools">
            <button
              type="button"
              className="composer-control composer-model-trigger qs-trigger"
              aria-expanded={open}
              data-popup-open={open || undefined}
              onClick={onToggle}
            >
              <Current preset={at} dir={dir} />
            </button>
            <span className="composer-divider" aria-hidden />
            <span className="composer-control">Build</span>
            <span className="qs-spacer" />
            <span className="qs-send" aria-hidden>↑</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickSwitchSettings({
  presets,
  setPresets,
}: {
  presets: Preset[];
  setPresets: (next: Preset[]) => void;
}) {
  const [on, setOn] = useState(true);
  const update = (i: number, next: Partial<Preset>) =>
    setPresets(presets.map((p, j) => (j === i ? { ...p, ...next } : p)));
  return (
    <div className="qs-settings">
      <header className="qs-settings-head">
        <h3>Quick switch</h3>
        <p>Model presets you jump between from the composer.</p>
      </header>
      <SettingsCard>
        <SettingsRow
          label="Step through presets"
          hint={`${keysLabel} in the composer moves between these. Off, or with none set up, the keys step effort like before.`}
        >
          <Switch label="Step through presets" checked={on} onChange={setOn} />
        </SettingsRow>
      </SettingsCard>
      <SettingsCard className="qs-presets">
        {presets.map((p, i) => {
          const efforts = catalog[p.provider].efforts;
          return (
            <div key={p.id} className="qs-preset">
              <GripVertical size={14} className="qs-grip" aria-hidden />
              <div className="composer-tools qs-preset-fields">
                <ComposerSelect<AgentProvider>
                  label="Agent"
                  value={p.provider}
                  icon={<ProviderIcon provider={p.provider} />}
                  options={agentProviders.map((provider) => ({
                    value: provider,
                    label: agentName(provider),
                    icon: <ProviderIcon provider={provider} />,
                  }))}
                  onChange={(provider) =>
                    update(i, {
                      provider,
                      model: catalog[provider].models.at(-1)!.id,
                      effort: catalog[provider].efforts.includes(p.effort) ? p.effort : "",
                      fast: false,
                    })
                  }
                />
                <ComposerSelect<string>
                  label="Model"
                  value={p.model}
                  options={catalog[p.provider].models.map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
                  onChange={(model) => update(i, { model })}
                />
              </div>
              {efforts.length ? (
                <div className="segmented qs-efforts" role="radiogroup" aria-label="Reasoning effort">
                  {efforts.map((e) => (
                    <button
                      key={e}
                      type="button"
                      role="radio"
                      aria-checked={e === p.effort}
                      className={e === p.effort ? "active" : ""}
                      onClick={() => update(i, { effort: e === p.effort ? "" : e })}
                    >
                      {e === "xhigh" ? "XHigh" : effortLabels[e]}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="qs-efforts qs-efforts-none">Default effort</span>
              )}
              {p.provider === "codex" ? (
                <button
                  type="button"
                  className="qs-icon-button"
                  aria-label="Fast mode"
                  aria-pressed={!!p.fast}
                  title={p.fast ? "Fast mode on" : "Fast mode off"}
                  onClick={() => update(i, { fast: !p.fast })}
                >
                  <Zap size={13} />
                </button>
              ) : (
                <span className="qs-icon-button" />
              )}
              <button
                type="button"
                className="qs-icon-button"
                aria-label={`Remove ${modelName(p)}`}
                onClick={() => setPresets(presets.filter((_, j) => j !== i))}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="qs-add"
          disabled={presets.length >= 8}
          onClick={() =>
            setPresets([
              ...presets,
              {
                id: Math.random().toString(36).slice(2),
                provider: "claude",
                model: "claude-sonnet-5-5",
                effort: "high",
              },
            ])
          }
        >
          <Plus size={14} /> Add preset
        </button>
      </SettingsCard>
    </div>
  );
}

type View = Variant | "settings";
const views: [View, string][] = [
  ["track", "A · Track"],
  ["list", "B · List"],
  ["drum", "C · Drum"],
  ["dock", "D · Dock"],
  ["tab", "E · Tab"],
  ["settings", "Settings"],
];

function Preview() {
  const params = new URLSearchParams(location.search);
  const [view, setView] = useState<View>((params.get("view") as View) || "track");
  const [presets, setPresets] = useState(samplePresets);
  const [index, setIndex] = useState(Number(params.get("at") ?? 2));
  const [dir, setDir] = useState(1);
  const [open, setOpen] = useState(!params.has("closed"));
  const safe = Math.max(0, Math.min(index, presets.length - 1));

  const pick = useCallback(
    (i: number) => {
      setDir(i < safe ? -1 : 1);
      setIndex(i);
    },
    [safe],
  );
  const step = useCallback(
    (d: -1 | 1) => pick(Math.max(0, Math.min(presets.length - 1, safe + d))),
    [pick, presets.length, safe],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave the Settings dropdowns their own arrow keys.
      if ((e.target as HTMLElement).closest("input, [role=listbox]:not([data-qs-rows])")) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") step(-1);
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") step(1);
      else return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  return (
    <div className="qs-page">
      <nav className="qs-switcher" aria-label="Option">
        {views.map(([v, label]) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
            {label}
          </button>
        ))}
        <span className="qs-sample">Sample data · ← → to step</span>
      </nav>
      {view === "settings" ? (
        <QuickSwitchSettings presets={presets} setPresets={setPresets} />
      ) : (
        <>
          <ComposerMock
            variant={view}
            presets={presets}
            index={safe}
            dir={dir}
            open={open}
            onToggle={() => setOpen((o) => !o)}
            onPick={pick}
          />
          <div className="qs-steppers">
            <button type="button" aria-label="Previous preset" onClick={() => step(-1)}>
              <ChevronLeft size={15} />
            </button>
            <button type="button" aria-label="Next preset" onClick={() => step(1)}>
              <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
