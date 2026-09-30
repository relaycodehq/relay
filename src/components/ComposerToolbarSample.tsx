import { useState } from "react";
import { Mic, Paperclip, Zap } from "lucide-react";
import type { AgentProvider } from "../../shared/agents";
import { useAISettings } from "../lib/useAISettings";
import { useCatalogs } from "../lib/useCatalogs";
import { ComposerModelPicker } from "./ComposerModelPicker";
import { ComposerSelect } from "./ComposerSelect";
import { ComposerTraitsMenu } from "./ComposerTraitsMenu";
import { InteractionModeMenu, RuntimeModeSelect } from "./ComposerModeControls";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { UsageDial } from "./UsageRing";
import type { ToolbarControls } from "./ComposerToolbar";

const noop = () => {};
const one = (label: string) => [{ value: label, label }];

/**
 * The composer's controls for the default agent, on sample values, for
 * Settings to arrange. They sit inert there, so nothing needs to work.
 */
export function useSampleControls(): ToolbarControls {
  const agent: AgentProvider = useAISettings().data?.threadProvider ?? "claude";
  const models = useCatalogs().modelsOf(agent);
  // The cache fire burns from when Settings opened.
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
              value: "High",
              options: one("High"),
              onChange: noop,
            },
            {
              label: "Context",
              value: "1M",
              options: one("1M"),
              onChange: noop,
            },
          ]}
        />
      ) : (
        <>
          <ComposerSelect
            label="Reasoning effort"
            value="Medium"
            options={one("Medium")}
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
          usedTokens: 184_000,
          maxTokens: 1_000_000,
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
    attach: (
      <button type="button" className="composer-control">
        <Paperclip size={15} />
      </button>
    ),
    usage: (
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
