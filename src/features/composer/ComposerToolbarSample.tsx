import { useState } from "react";
import { ChevronDown, Mic, Paperclip, UserRound, Zap } from "lucide-react";
import { reportsUsage, type AgentProvider } from "../../../shared/agents";
import { useAISettings } from "../agents/useAISettings";
import { useCatalogs } from "../agents/useCatalogs";
import { ComposerModelPicker } from "../agents/ComposerModelPicker";
import { ComposerSelect } from "../../ui/ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";
import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ContextWindowMeter } from "../agents/ContextWindowMeter";
import { UsageDial } from "../agents/UsageDial";
import type { ToolbarControls } from "./ComposerToolbar";

const noop = () => {};
const one = (label: string) => [{ value: label, label }];

/** A picked model to show instead of the default agent's first one. */
export interface SampleModel {
  agent: AgentProvider;
  name: string;
  /** As the effort control labels it, e.g. "High". */
  effort: string;
  /** The context window in tokens. */
  window: number;
}

/**
 * The composer's controls on sample values: the default agent's for Settings
 * to arrange, or a given model's for the website's window. They sit inert, so
 * nothing needs to work.
 */
export function useSampleControls(sample?: SampleModel): ToolbarControls {
  const preferred = useAISettings().data?.threadProvider ?? "claude";
  const agent: AgentProvider = sample?.agent ?? preferred;
  const listed = useCatalogs().modelsOf(agent);
  const models = sample
    ? [{ id: sample.name, name: sample.name, description: "", efforts: [] }]
    : listed;
  const effort = sample?.effort ?? (agent === "claude" ? "High" : "Medium");
  const contextWindow = sample?.window ?? 1_000_000;
  // The cache fire burns from when the controls first showed.
  const [cachedAt] = useState(Date.now);
  return {
    model: (
      <ComposerModelPicker
        provider={agent}
        ready
        catalogs={{ [agent]: { models, model: models?.[0]?.id ?? "" } }}
        onSelect={noop}
      />
    ),
    effort:
      agent === "claude" ? (
        <ComposerTraitsMenu
          label="Reasoning effort and context window"
          sections={[
            {
              label: "Reasoning",
              value: effort,
              options: one(effort),
              onChange: noop,
            },
            {
              label: "Context",
              value: windowLabel(contextWindow),
              options: one(windowLabel(contextWindow)),
              onChange: noop,
            },
          ]}
        />
      ) : (
        <>
          <ComposerSelect
            label="Reasoning effort"
            value={effort}
            options={one(effort)}
            onChange={noop}
          />
          {agent === "codex" && (
            <button type="button" className="composer-control composer-fast">
              <Zap size={14} />
              Fast
            </button>
          )}
        </>
      ),
    context: (
      <ContextWindowMeter
        usage={{
          usedTokens: Math.round(contextWindow * 0.184),
          maxTokens: contextWindow,
          cache: { at: cachedAt, ttlMs: 60 * 60_000 },
        }}
        provider={agent}
        compacting={false}
        compactDisabled
        onCompact={noop}
      />
    ),
    access: (
      <RuntimeModeSelect
        provider={agent}
        runtimeMode="full-access"
        onRuntimeMode={noop}
      />
    ),
    mode: (
      <InteractionModeMenu interactionMode="default" onInteractionMode={noop} />
    ),
    account: (
      <button type="button" className="composer-control">
        <UserRound size={13} />
        Work
        <ChevronDown size={12} />
      </button>
    ),
    attach: (
      <button type="button" className="composer-control">
        <Paperclip size={15} />
      </button>
    ),
    usage: reportsUsage(agent) && (
      <span className="composer-control usage-ring-trigger">
        <UsageDial
          meters={[
            { kind: "weekly", leftPercent: 83, pace: "ok" },
            { kind: "session", leftPercent: 65, pace: "ok" },
          ]}
        />
      </span>
    ),
    mic: (
      <button type="button" className="composer-control dictation-mic">
        <Mic size={15} />
      </button>
    ),
  };
}

const windowLabel = (tokens: number) =>
  tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${tokens / 1000}k`;
