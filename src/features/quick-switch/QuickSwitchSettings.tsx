import { useState, type KeyboardEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  GripVertical,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { agentProviders, agents } from "../../../shared/agents";
import { onModel } from "../../../shared/model-fit";
import { effortLabels, type ReasoningEffort } from "../../../shared/settings";
import { useCatalogs } from "../agents/useCatalogs";
import { useQuickKeysLabel } from "./effort-shortcut";
import {
  maxPresets,
  newPresetId,
  quickItems,
  quickSwitchStyles,
  setQuickSwitch,
  stepPreset,
  useQuickSwitch,
  type QuickItem,
  type QuickPreset,
  type QuickSwitch,
  type QuickSwitchStyle,
} from "./quick-switch";
import { ComposerModelPicker } from "../agents/ComposerModelPicker";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { QuickSwitchHud } from "./QuickSwitchHud";
import {
  Segmented,
  SettingsCard,
  SettingsRow,
  Switch,
} from "../../ui/SettingsCard";

const styleNames: Record<QuickSwitchStyle, string> = {
  drum: "Drum",
  list: "List",
  track: "Track",
  dock: "Dock",
  tab: "Tab",
  revolver: "Revolver",
};

/** The quick switch's settings: on or off, its style, and the presets in order. */
export function QuickSwitchSettings() {
  const quickKeys = useQuickKeysLabel();
  const quick = useQuickSwitch();
  const catalogs = useCatalogs();
  const save = (next: Partial<QuickSwitch>) =>
    setQuickSwitch({ ...quick, ...next });
  const presets = quick.presets;
  const update = (i: number, next: Partial<QuickPreset>) =>
    save({ presets: presets.map((p, j) => (j === i ? { ...p, ...next } : p)) });
  const [dragging, setDragging] = useState<number>();
  const move = (from: number, to: number) => {
    const next = [...presets];
    next.splice(to, 0, ...next.splice(from, 1));
    save({ presets: next });
  };
  return (
    <div className="quick-settings">
      <SettingsCard>
        <SettingsRow
          label="Step through presets"
          hint={`${quickKeys || "The quick-switch keys"} in the composer move between these. Effort keeps its own keys.`}
        >
          <Switch
            label="Step through presets"
            checked={quick.enabled}
            onChange={(enabled) => save({ enabled })}
          />
        </SettingsRow>
        <SettingsRow
          label="Style"
          hint="How the switcher looks over the composer."
          below={
            presets.length > 0 && (
              <StyleSample
                style={quick.style}
                items={quickItems(presets, catalogs.modelsOf)}
              />
            )
          }
        >
          <Segmented
            value={quick.style}
            options={quickSwitchStyles.map((style) => [
              style,
              styleNames[style],
            ])}
            onChange={(style) => save({ style })}
          />
        </SettingsRow>
        {quick.style === "revolver" && (
          <SettingsRow
            label="Click sound"
            hint="The revolver clicks as each chamber passes the notch."
          >
            <Switch
              label="Click sound"
              checked={quick.sound}
              onChange={(sound) => save({ sound })}
            />
          </SettingsRow>
        )}
      </SettingsCard>
      <SettingsCard className="quick-presets">
        {presets.length === 0 && (
          <p className="quick-presets-empty">
            No presets yet. Add the agents, models and efforts you switch
            between most.
          </p>
        )}
        {presets.map((p, i) => {
          const efforts = catalogs.effortsOf(p.provider, p.model);
          return (
            <div
              key={p.id}
              className="quick-preset"
              data-dragging={dragging === i || undefined}
              onDragOver={(e) => {
                if (dragging === undefined || dragging === i) return;
                e.preventDefault();
                move(dragging, i);
                setDragging(i);
              }}
            >
              <span
                className="quick-grip"
                draggable
                title="Drag to reorder"
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(i);
                }}
                onDragEnd={() => setDragging(undefined)}
              >
                <GripVertical size={14} aria-hidden />
              </span>
              <div className="composer-tools model-field quick-preset-fields">
                <ComposerModelPicker
                  label={`Preset ${i + 1}`}
                  providers={[...agentProviders]}
                  provider={p.provider}
                  catalogs={Object.fromEntries(
                    agentProviders.map((a) => [
                      a,
                      {
                        models: catalogs.modelsOf(a),
                        model: a === p.provider ? p.model : "",
                      },
                    ]),
                  )}
                  onOpen={catalogs.refresh}
                  onSelect={(next, model) => {
                    if (next === "message") return;
                    update(i, {
                      provider: next,
                      ...onModel(
                        next,
                        p,
                        model,
                        catalogs.effortsOf(next, model),
                      ),
                    });
                  }}
                />
                {efforts.length > 0 && (
                  <>
                    <span className="composer-divider" aria-hidden />
                    <ComposerSelect<ReasoningEffort>
                      label={`Preset ${i + 1} reasoning effort`}
                      value={p.reasoningEffort}
                      options={[
                        { value: "", label: "Default effort" },
                        ...efforts.map((effort) => ({
                          value: effort,
                          label: effortLabels[effort],
                        })),
                      ]}
                      onChange={(reasoningEffort) =>
                        update(i, { reasoningEffort })
                      }
                    />
                  </>
                )}
                {agents[p.provider].fast && (
                  <button
                    type="button"
                    className="composer-control composer-fast"
                    aria-label={`Preset ${i + 1} Fast mode`}
                    aria-pressed={p.fast}
                    title={p.fast ? "Fast mode enabled" : "Enable Fast mode"}
                    onClick={() => update(i, { fast: !p.fast })}
                  >
                    <Zap size={14} />
                    Fast
                  </button>
                )}
              </div>
              <button
                type="button"
                className="quick-remove"
                aria-label={`Remove preset ${i + 1}`}
                onClick={() =>
                  save({ presets: presets.filter((_, j) => j !== i) })
                }
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="quick-add"
          disabled={presets.length >= maxPresets}
          onClick={() =>
            save({
              presets: [
                ...presets,
                {
                  id: newPresetId(),
                  provider: presets.at(-1)?.provider ?? "claude",
                  model: "",
                  reasoningEffort: "",
                  fast: false,
                },
              ],
            })
          }
        >
          <Plus size={14} /> Add preset
        </button>
      </SettingsCard>
    </div>
  );
}

/** The chosen style over a sliver of composer; click it or use ←→ to try it. */
function StyleSample({
  style,
  items,
}: {
  style: QuickSwitchStyle;
  items: QuickItem[];
}) {
  const [state, setState] = useState({ at: 0, dir: 1 });
  const at = Math.min(state.at, items.length - 1);
  const pick = (to: number, dir?: number) =>
    to !== at && setState({ at: to, dir: dir ?? (to < at ? -1 : 1) });
  const go = (step: -1 | 1) =>
    pick(stepPreset(items.length, at, step, style === "revolver"), step);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = (
      { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 } as const
    )[e.key as "ArrowLeft"];
    if (!step) return;
    e.preventDefault();
    go(step);
  };
  return (
    <div
      className="quick-switch-sample"
      data-style={style}
      tabIndex={0}
      aria-label="Style sample; use the arrow keys to step"
      onKeyDown={onKeyDown}
    >
      <QuickSwitchHud
        // A new style starts fresh, so the Dock measures its own tiles.
        key={style}
        style={style}
        open
        items={items}
        index={at}
        dir={state.dir}
        onPick={pick}
      />
      <div className="quick-sample-composer">
        <button
          type="button"
          aria-label="Previous preset"
          onClick={() => go(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button type="button" aria-label="Next preset" onClick={() => go(1)}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
