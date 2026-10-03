// Settings → AI models → Accounts: pick the account new threads use by
// clicking its line, and order the rest for when it runs out.
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { SettingsRow, Switch } from "../../src/ui/SettingsCard";
import { headroom, resetClock, type Accounts, type Provider } from "./accounts-data";
import { AddAccount, Bars, InUse, Name, ProviderHead, RowMenu, Who } from "./accounts-parts";

export function AccountSettings({ store }: { store: Accounts }) {
  return (
    <>
      <div className="settings-card">
        <SettingsRow
          label="Move on when an account runs out"
          hint="An answer that hits a limit carries on with the next account down the list, and new threads start there too. Off, it waits for the reset."
        >
          <Switch
            label="Move on when an account runs out"
            checked={store.autoSwitch}
            onChange={store.setAutoSwitch}
          />
        </SettingsRow>
      </div>
      {(["claude", "codex"] as Provider[]).map((provider) => (
        <ProviderCard key={provider} provider={provider} store={store} />
      ))}
    </>
  );
}

function ProviderCard({ provider, store }: { provider: Provider; store: Accounts }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = store.of(provider);
  const several = list.length > 1;
  return (
    <div className="settings-card acc-card">
      <ProviderHead provider={provider}>
        <AddAccount provider={provider} store={store} compact />
      </ProviderHead>
      {list.map((a, i) => {
        const inUse = several && store.defaults[provider] === a.id;
        const out = headroom(a) === 0;
        return (
          <div
            key={a.id}
            className="acc-row acc-pick"
            data-several={several || undefined}
            data-in-use={inUse || undefined}
            data-spent={out || undefined}
          >
            {several && (
              <span className="acc-order">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${a.label} up`}
                  disabled={i === 0}
                  onClick={() => store.move(a, -1)}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Move ${a.label} down`}
                  disabled={i === list.length - 1}
                  onClick={() => store.move(a, 1)}
                >
                  <ArrowDown size={12} />
                </button>
              </span>
            )}
            <label className="acc-pick-main">
              {several && (
                <input
                  type="radio"
                  className="acc-pick-radio"
                  name={`in-use-${provider}`}
                  checked={store.defaults[provider] === a.id}
                  onChange={() => store.makeDefault(a)}
                />
              )}
              <span className="acc-row-text">
                <span className="acc-row-title">
                  <Name
                    account={a}
                    store={store}
                    editing={renaming === a.id}
                    onDone={() => setRenaming(null)}
                  />
                  {inUse && <InUse />}
                  {out && <span className="acc-quiet">Out until {resetClock(a)}</span>}
                </span>
                <Who account={a} />
              </span>
              <Bars account={a} />
            </label>
            <RowMenu account={a} store={store} onRename={() => setRenaming(a.id)} />
          </div>
        );
      })}
      {several && (
        <p className="acc-card-note">
          New threads start on the one you pick. When it runs out, the next one down takes over.
        </p>
      )}
    </div>
  );
}
