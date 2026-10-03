// The model picker with the account above its usage meters. The shell is the
// picker's markup on sample rows; the meters are the real UsageMeters.
import { Popover } from "@base-ui/react/popover";
import { Check, Search, Star } from "lucide-react";
import { ProviderIcon } from "../../src/features/agents/ComposerModelPicker";
import { UsageMeters } from "../../src/features/agents/UsageMeters";
import { SESSION_MS, WEEK_MS, type ProviderUsage } from "../../shared/provider-usage";
import { headroom, type Account, type Accounts } from "./accounts-data";
import { Dial } from "./accounts-parts";

const NOW = Date.now();
const MODELS = {
  claude: [
    ["Opus 5.5", "For complex work and everyday tasks"],
    ["Fable 5.1", "For your toughest challenges"],
    ["Sonnet 5.5", "Most efficient for simpler tasks"],
    ["Haiku 4.5", "Fastest for quick answers"],
  ],
  codex: [
    ["GPT-6 Astra", "Frontier agentic coding"],
    ["GPT-6 Luna", "Fast and capable"],
    ["GPT-6 Mini", "Cheapest for small edits"],
  ],
};

function usageOf(a: Account): ProviderUsage {
  return {
    provider: a.provider,
    message: null,
    windows: [
      { kind: "session", usedPercent: a.sessionUsed, resetsAt: NOW + a.sessionResetsIn, periodMs: SESSION_MS },
      { kind: "weekly", usedPercent: a.weeklyUsed, resetsAt: NOW + a.weeklyResetsIn, periodMs: WEEK_MS },
    ],
  };
}

export function ModelPicker({ store, model }: { store: Accounts; model: string }) {
  const { provider } = store.thread;
  return (
    <Popover.Root>
      <Popover.Trigger className="composer-control composer-model-trigger" aria-label="Choose model">
        <ProviderIcon provider={provider} />
        <span>{model}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="composer-popup-positioner" side="top" align="start" sideOffset={6}>
          <Popover.Popup className="model-picker-popup acc-model-popup" aria-label="Choose model and provider">
            <div className="model-picker-rail">
              <button type="button" className="model-provider-tab" aria-label="Favorites">
                <Star className="provider-glyph" fill="currentColor" />
              </button>
              {(["codex", "claude"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="model-provider-tab"
                  aria-pressed={p === provider}
                  aria-label={p}
                  onClick={() => store.setProvider(p)}
                >
                  <ProviderIcon provider={p} />
                </button>
              ))}
            </div>
            <div className="model-picker-content">
              <div className="model-picker-list">
                <div className="model-picker-search">
                  <Search size={16} aria-hidden />
                  <input aria-label="Search models" placeholder="Search models…" />
                </div>
                <div className="model-picker-columns">
                  <div className="model-picker-scroll">
                    {MODELS[provider].map(([name, sub], i) => (
                      <div key={name} className="model-picker-row">
                        <div className="model-picker-row-label">
                          <span>{name}</span>
                          <small>
                            <ProviderIcon provider={provider} />
                            <span>{sub}</span>
                          </small>
                        </div>
                        <div className="model-picker-row-actions">
                          {name === model && <Check size={12} aria-hidden />}
                          <kbd>⌘{i + 1}</kbd>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <AccountFooter store={store} />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The accounts as tabs over the meters: what's in use, and one click to switch. */
function AccountFooter({ store }: { store: Accounts }) {
  const { provider, accountId } = store.thread;
  const list = store.of(provider);
  const current = store.byId(accountId)!;
  if (list.length < 2) return <UsageMeters usage={usageOf(current)} now={NOW} />;
  return (
    <div className="acc-footer">
      <div className="acc-tabs" role="radiogroup" aria-label="Account">
        {list.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={a.id === accountId}
            onClick={() => a.id !== accountId && store.use(a.id)}
          >
            <Dial account={a} />
            {a.label}
            <small>{headroom(a)}% left</small>
          </button>
        ))}
      </div>
      <UsageMeters usage={usageOf(current)} now={NOW} />
    </div>
  );
}
